import { RateLimitType, RateLimitStore, RateLimitSettings, DORateLimitConfig, KVRateLimitConfig } from './config';
import { createObjectLogger } from '../../logger';
import { AuthUser } from '../../types/auth-types';
import { extractTokenWithMetadata, extractRequestMetadata } from '../../utils/authUtils';
import { captureSecurityEvent } from '../../observability/sentry';
import { KVRateLimitStore } from './KVRateLimitStore';
import { RateLimitResult } from './DORateLimitStore';
import { RateLimitExceededError, SecurityError } from 'shared/types/errors';
import { isDev } from 'worker/utils/envs';
import { AIModels, getEffectiveModelConfig } from 'worker/agents/inferutils/config.types';

export class RateLimitService {
    static logger = createObjectLogger(this, 'RateLimitService');

    static buildRateLimitKey(
		rateLimitType: RateLimitType,
		identifier: string
	): string {
		return `platform:${rateLimitType}:${identifier}`;
	}

	static async getUserIdentifier(user: AuthUser): Promise<string> {
		return `user:${user.id}`;
	}

    static async getRequestIdentifier(request: Request): Promise<string> {
        const tokenResult = extractTokenWithMetadata(request);
        if (tokenResult.token) {
            const encoder = new TextEncoder();
            const data = encoder.encode(tokenResult.token);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return `token:${hashHex.slice(0, 16)}`;
        }
    
        const metadata = extractRequestMetadata(request);
        return `ip:${metadata.ipAddress}`;
    }

    static async getUniversalIdentifier(user: AuthUser | null, request: Request): Promise<string> {
        if (user) {
            return this.getUserIdentifier(user);
        }
        return this.getRequestIdentifier(request);
    }

    /**
     * Durable Object-based rate limiting using bucketed sliding window algorithm
     * Provides better consistency and performance compared to KV
     */
    private static async enforceDORateLimit(
        env: Env,
        key: string,
        config: DORateLimitConfig,
        incrementBy: number = 1
    ): Promise<RateLimitResult> {
        try {
            const stub = env.DORateLimitStore.getByName(key);

            const result = await stub.increment(key, {
                limit: config.limit,
                period: config.period,
                burst: config.burst,
                burstWindow: config.burstWindow,
                bucketSize: config.bucketSize,
                dailyLimit: config.dailyLimit,
                calendarDaily: config.calendarDaily,
            }, incrementBy);

            return result;
        } catch (error) {
            this.logger.error('Failed to enforce DO rate limit', {
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return { success: true }; // Fail open
        }
    }
    
    static async enforce(
        env: Env,
        key: string,
        config: RateLimitSettings,
        limitType: RateLimitType,
        incrementBy: number = 1
    ): Promise<RateLimitResult> {
        const rateLimitConfig = config[limitType];
        
        // In dev mode, only skip binding-based rate limiters (they don't work locally)
        // DO-based rate limiting works locally
        if (isDev(env) && rateLimitConfig.store === RateLimitStore.RATE_LIMITER) {
            return { success: true };
        }
        
        switch (rateLimitConfig.store) {
            case RateLimitStore.RATE_LIMITER: {
                const result = await (env[rateLimitConfig.bindingName as keyof Env] as RateLimit).limit({ key });
                return { success: result.success };
            }
            case RateLimitStore.KV: {
                return await KVRateLimitStore.increment(env.VibecoderStore, key, rateLimitConfig as KVRateLimitConfig, incrementBy);
            }
            case RateLimitStore.DURABLE_OBJECT:
                return await this.enforceDORateLimit(env, key, rateLimitConfig as DORateLimitConfig, incrementBy);
            default:
                return { success: false };
        }
    }

    static async enforceGlobalApiRateLimit(
        env: Env,
        config: RateLimitSettings,
        user: AuthUser | null,
        request: Request
    ): Promise<void> {
        if (!config[RateLimitType.API_RATE_LIMIT].enabled) {
            return;
        }
        const identifier = await this.getUniversalIdentifier(user, request);

        const key = this.buildRateLimitKey(RateLimitType.API_RATE_LIMIT, identifier);
        
        try {
            const result = await this.enforce(env, key, config, RateLimitType.API_RATE_LIMIT);
            if (!result.success) {
                this.logger.warn('Global API rate limit exceeded', {
                    identifier,
                    key,
                    userAgent: request.headers.get('User-Agent'),
                    ip: request.headers.get('CF-Connecting-IP')
                });
                captureSecurityEvent('rate_limit_exceeded', {
                    limitType: RateLimitType.API_RATE_LIMIT,
                    identifier,
                    key,
                    userAgent: request.headers.get('User-Agent') || undefined,
                    ip: request.headers.get('CF-Connecting-IP') || undefined,
                });
                throw new RateLimitExceededError(`Global API rate limit exceeded`, RateLimitType.API_RATE_LIMIT);
            }
        } catch (error) {
            if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
                throw error;
            }
            this.logger.error('Failed to enforce global API rate limit', error);
        }
    }

    static async enforceAuthRateLimit(
        env: Env,
        config: RateLimitSettings,
        user: AuthUser | null,
        request: Request
    ) {
        
        if (!config[RateLimitType.AUTH_RATE_LIMIT].enabled) {
            return;
        }
        const identifier = await this.getUniversalIdentifier(user, request);

        const key = this.buildRateLimitKey(RateLimitType.AUTH_RATE_LIMIT, identifier);
        
        try {
            const result = await this.enforce(env, key, config, RateLimitType.AUTH_RATE_LIMIT);
            if (!result.success) {
                this.logger.warn('Auth rate limit exceeded', {
                    identifier,
                    key,
                    userAgent: request.headers.get('User-Agent'),
                    ip: request.headers.get('CF-Connecting-IP')
                });
                captureSecurityEvent('rate_limit_exceeded', {
                    limitType: RateLimitType.AUTH_RATE_LIMIT,
                    identifier,
                    key,
                    userAgent: request.headers.get('User-Agent') || undefined,
                    ip: request.headers.get('CF-Connecting-IP') || undefined,
                });
                throw new RateLimitExceededError(`Auth rate limit exceeded`, RateLimitType.AUTH_RATE_LIMIT);
            }
        } catch (error) {
            if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
                throw error;
            }
            this.logger.error('Failed to enforce auth rate limit', error);
        }
    }

	static async enforceAppCreationRateLimit(
		env: Env,
		config: RateLimitSettings,
		user: AuthUser,
		request: Request
	): Promise<void> {
		if (!config[RateLimitType.APP_CREATION].enabled) {
			return;
		}
		const identifier = await this.getUserIdentifier(user);

		const key = this.buildRateLimitKey(RateLimitType.APP_CREATION, identifier);
		
		try {
            const result = await this.enforce(env, key, config, RateLimitType.APP_CREATION);
			if (!result.success) {
				this.logger.warn('App creation rate limit exceeded', {
					identifier,
					key,
					exceededLimit: result.exceededLimit,
					limitValue: result.limitValue,
					userAgent: request.headers.get('User-Agent'),
					ip: request.headers.get('CF-Connecting-IP')
				});
				captureSecurityEvent('rate_limit_exceeded', {
					limitType: RateLimitType.APP_CREATION,
					identifier,
					key,
					exceededLimit: result.exceededLimit,
					userAgent: request.headers.get('User-Agent') || undefined,
					ip: request.headers.get('CF-Connecting-IP') || undefined,
				});

				// Build error message based on which limit was exceeded
				const limitValue = result.limitValue ?? config.appCreation.limit;
				const periodSeconds = result.periodSeconds ?? config.appCreation.period;
				const periodHours = periodSeconds / 3600;
				const periodLabel = result.exceededLimit === 'daily'
					? 'day'
					: `${periodHours} hour${periodHours >= 2 ? 's' : ''}`;

				throw new RateLimitExceededError(
					`App creation rate limit exceeded. Maximum ${limitValue} apps per ${periodLabel}`,
					RateLimitType.APP_CREATION,
					limitValue,
					periodSeconds,
                    ['Please try again later when the limit resets for you.']
				);
			}
		} catch (error) {
			if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
				throw error;
			}
			this.logger.error('Failed to enforce app creation rate limit', error);
		}
	}

	/**
	 * Get remaining credits for LLM calls without incrementing (for pre-flight checks)
	 * Works in both dev and prod - uses local DO in dev mode
	 */
	static async getRemainingCredits(
		env: Env,
		config: RateLimitSettings,
		userId: string
	): Promise<{ remaining: number; limit: number; dailyRemaining?: number; dailyLimit?: number }> {
		const identifier = `user:${userId}`;
		const key = this.buildRateLimitKey(RateLimitType.LLM_CALLS, identifier);
		const llmConfig = config[RateLimitType.LLM_CALLS] as DORateLimitConfig;

		try {
			const stub = env.DORateLimitStore.getByName(key);
			const remaining = await stub.getRemainingLimit(key, {
				limit: llmConfig.limit,
				period: llmConfig.period,
				dailyLimit: llmConfig.dailyLimit,
				bucketSize: llmConfig.bucketSize,
				calendarDaily: llmConfig.calendarDaily,
			});

			return {
				remaining,
				limit: llmConfig.limit,
				dailyLimit: llmConfig.dailyLimit,
			};
		} catch (error) {
			this.logger.error('Failed to get remaining credits', {
				key,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			// Fail open - return full limit
			return {
				remaining: llmConfig.limit,
				limit: llmConfig.limit,
				dailyLimit: llmConfig.dailyLimit,
			};
		}
	}

	/**
	 * Check if user is within free tier limits (without incrementing)
	 */
	static async isWithinLimits(
		env: Env,
		config: RateLimitSettings,
		userId: string
	): Promise<boolean> {
		const { remaining } = await this.getRemainingCredits(env, config, userId);
		return remaining > 0;
	}

	/**
	 * Record actual token usage from an LLM call and deduct credits proportionally.
	 * Called AFTER the LLM call returns. Fair to small prompts, scales for big ones.
	 *
	 * Formula: actualCredits = creditCost × max(0.1, (inputTokens + 4×outputTokens) / 30000)
	 * - 30k-token average call ≈ 1× creditCost (matches old flat behaviour)
	 * - Tiny "hello" message (≈100 tokens) ≈ 0.1× creditCost (minimum)
	 * - Big 200k blueprint ≈ 7× creditCost (pays its real share)
	 * - Output weighted 4× because output is typically 3-5× more expensive than input
	 *
	 * Fire-and-forget — never throws. Worst case: balance goes slightly negative.
	 * Next pre-flight check will catch it.
	 */
	static async recordActualUsage(
		env: Env,
		userId: string,
		model: AIModels | string,
		inputTokens: number,
		outputTokens: number,
	): Promise<void> {
		try {
			const modelConfig = getEffectiveModelConfig(model);
			if (!modelConfig) {
				this.logger.warn('Unknown model in recordActualUsage', { model });
				return;
			}
			const weighted = inputTokens + (outputTokens * 4);
			const sizeFactor = Math.max(0.1, weighted / 30000);
			const actualCredits = modelConfig.creditCost * sizeFactor;

			const creditKey = `user_credits:${userId}`;
			const rawBalance = await env.VibecoderStore.get(creditKey);
			const currentBalance = rawBalance === null ? 0 : parseFloat(rawBalance);
			const newBalance = Math.max(0, currentBalance - actualCredits);
			await env.VibecoderStore.put(creditKey, String(newBalance));

			// Log the real, token-weighted cost for the admin cost dashboard. This runs on
			// every completed call (independent of rate limiting), so the dashboard reflects
			// actual usage rather than a flat per-call estimate. Fire-and-forget.
			env.DB.prepare(
				'INSERT INTO ai_usage_logs (id, user_id, model, credit_cost, created_at) VALUES (?, ?, ?, ?, ?)'
			).bind(crypto.randomUUID(), userId, model, actualCredits, Math.floor(Date.now() / 1000)).run().catch(() => {});

			this.logger.debug('Recorded actual usage', {
				userId, model, inputTokens, outputTokens,
				actualCredits: actualCredits.toFixed(2),
				newBalance: newBalance.toFixed(2),
			});
		} catch (error) {
			this.logger.error('Failed to record actual usage', { error });
		}
	}

	/**
	 * Deduct credits for a non-inference operation (e.g. Workers AI image generation).
	 * Throws RateLimitExceededError if balance is insufficient.
	 */
	static async deductCredits(
		env: Env,
		userId: string,
		amount: number,
		opName: string,
	): Promise<void> {
		const creditKey = `user_credits:${userId}`;
		const rawBalance = await env.VibecoderStore.get(creditKey);
		const currentBalance = rawBalance === null ? 0 : parseFloat(rawBalance);
		if (currentBalance < amount) {
			this.logger.warn('Out of credits for operation', { userId, balance: currentBalance, required: amount, opName });
			throw new RateLimitExceededError(
				`Out of credits — ${opName} needs ${amount} but you only have ${Math.floor(currentBalance)}. Top up to continue.`,
				RateLimitType.LLM_CALLS,
				undefined,
				undefined,
				['Go to Settings → Add credits.'],
			);
		}
		const newBalance = Math.max(0, currentBalance - amount);
		await env.VibecoderStore.put(creditKey, String(newBalance));
	}

	static async enforceLLMCallsRateLimit(
        env: Env,
		config: RateLimitSettings,
		userId: string,
        model: AIModels | string,
        _suffix: string = "", // retained for positional caller compatibility; no longer used (throttle removed)
		isUsingBYOK: boolean = false,
		hasCloudflareConfigured: boolean = false
	): Promise<void> {

		const llmConfig = config[RateLimitType.LLM_CALLS];
		if (!llmConfig.enabled) {
			return;
		}

		// Skip rate limiting for BYOK users if configured
		if (isUsingBYOK && llmConfig.excludeBYOKUsers) {
			this.logger.debug('Skipping rate limit for BYOK user', { userId });
			return;
		}

		// Skip rate limiting for Cloudflare-connected users if configured
		if (hasCloudflareConfigured && llmConfig.excludeCloudflareConnected) {
			this.logger.debug('Skipping rate limit for Cloudflare-connected user', { userId });
			return;
		}

		try {
            // ── Credit balance is the ONLY gate ──
            // Verify the user holds credits, then let them spend at any rate. Actual deduction
            // happens after the call in recordActualUsage() based on real token usage. There is
            // NO daily/throttle cap: a paying user can build as much as they like, and can never
            // spend credits they don't hold, so we never lose money. (A future opt-in, user-set
            // daily/monthly spend cap would live here — chosen by the user, never imposed by us.)
            const creditKey = `user_credits:${userId}`;
            const rawBalance = await env.VibecoderStore.get(creditKey);
            const currentBalance = rawBalance === null ? 0 : parseFloat(rawBalance);
            if (currentBalance < 1) {
                this.logger.warn('Out of credits (pre-flight)', { userId, balance: currentBalance, model });
                throw new RateLimitExceededError(
                    `Out of credits. Top up to continue.`,
                    RateLimitType.LLM_CALLS,
                    undefined,
                    undefined,
                    ['Go to Settings → Add credits, or upgrade to Pro for 1,500 credits/month.'],
                );
            }
		} catch (error) {
			if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
				throw error;
			}
			this.logger.error('Failed to enforce LLM calls rate limit', error);
		}
	}
}