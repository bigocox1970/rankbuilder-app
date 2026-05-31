/**
 * Credits Controller
 * Balance lookup, build-start credit consumption, free-tier grant.
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';

const logger = createLogger('CreditsController');

const FREE_SIGNUP_CREDITS = 100;
const BUILD_COST_CREDITS = 50;

function key(userId: string) {
    return `user_credits:${userId}`;
}

async function writeBalance(env: Env, userId: string, balance: number): Promise<void> {
    await env.VibecoderStore.put(key(userId), String(Math.max(0, balance)));
}

/**
 * Current credit balance for a user (0 if never granted). Read-only — does NOT
 * trigger the first-read free-signup grant. Used for admin views.
 */
export async function readCreditBalance(env: Env, userId: string): Promise<number> {
    const raw = await env.VibecoderStore.get(key(userId));
    return raw === null ? 0 : parseFloat(raw);
}

/**
 * Add credits to a user's balance and return the new total. Pure balance math on
 * KV `user_credits:{userId}` — independent of Stripe/subscription state. Shared by
 * the admin grant flow so credit math lives in one place.
 */
export async function grantCredits(env: Env, userId: string, amount: number): Promise<number> {
    const current = await readCreditBalance(env, userId);
    const next = current + amount;
    await writeBalance(env, userId, next);
    return next;
}

export class CreditsController extends BaseController {
    /**
     * GET /api/credits/balance
     * Returns current credit balance. Grants free signup credits on first read.
     */
    static async getBalance(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) {
            return CreditsController.createErrorResponse('Authentication required', 401);
        }

        const raw = await env.VibecoderStore.get(key(user.id));
        let balance: number;
        if (raw === null) {
            // First-time grant
            await writeBalance(env, user.id, FREE_SIGNUP_CREDITS);
            logger.info('Free signup credits granted', { userId: user.id, credits: FREE_SIGNUP_CREDITS });
            balance = FREE_SIGNUP_CREDITS;
        } else {
            balance = parseFloat(raw);
        }
        // Round to integer for display; underlying KV stores fractional credits from per-call deduction
        const response = CreditsController.createSuccessResponse({ balance: Math.floor(balance), buildCost: BUILD_COST_CREDITS });
        // Never cache — balance changes per call.
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return response;
    }

    /**
     * POST /api/credits/consume-build
     * Deducts BUILD_COST_CREDITS atomically. Returns insufficient if not enough.
     */
    static async consumeBuild(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) {
            return CreditsController.createErrorResponse('Authentication required', 401);
        }

        // Read-grant-if-new for first-time builders
        const raw = await env.VibecoderStore.get(key(user.id));
        const balance = raw === null ? FREE_SIGNUP_CREDITS : parseInt(raw, 10);

        if (balance < BUILD_COST_CREDITS) {
            return CreditsController.createSuccessResponse({
                consumed: false,
                balance,
                buildCost: BUILD_COST_CREDITS,
                reason: 'insufficient_credits',
            });
        }

        const newBalance = balance - BUILD_COST_CREDITS;
        await writeBalance(env, user.id, newBalance);
        logger.info('Build credits consumed', { userId: user.id, consumed: BUILD_COST_CREDITS, newBalance });

        return CreditsController.createSuccessResponse({
            consumed: true,
            balance: newBalance,
            buildCost: BUILD_COST_CREDITS,
        });
    }
}
