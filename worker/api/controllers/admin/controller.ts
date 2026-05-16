/**
 * Admin Controller
 * Admin-only endpoints for cost reporting and user management
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AI_MODEL_CONFIG, AIModels } from 'worker/agents/inferutils/config.types';
import { AiGatewayAnalyticsService } from 'worker/services/analytics/AiGatewayAnalyticsService';
import type {
    AdminCostData,
    AdminCostEntry,
    AdminUsersData,
    AdminUserEntry,
    AdminUserActionData,
    AdminKvStatusData,
    AdminGatewayCostData,
    MiniMaxCostData,
} from './types';

// Credit cost baseline: 1 credit = $0.25
const CREDIT_TO_USD = 0.25;

interface UsageRow {
    model: string;
    call_count: number;
    total_credits: number;
}

interface UserRow {
    id: string;
    email: string;
    display_name: string;
    provider: string;
    created_at: number | null;
    last_active_at: number | null;
    is_active: number;
    is_suspended: number;
    app_count: number;
    total_credits: number;
}

interface CountRow {
    total: number;
}

export class AdminController extends BaseController {
    static logger = createLogger('AdminController');

    /**
     * GET /api/admin/costs
     * Returns AI usage cost breakdown by model for a given time period
     */
    static async getCosts(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const periodParam = context.queryParams.get('period') ?? '7d';
            const period = (['24h', '7d', '30d', 'all'] as const).includes(
                periodParam as '24h' | '7d' | '30d' | 'all',
            )
                ? (periodParam as '24h' | '7d' | '30d' | 'all')
                : '7d';

            let whereClause = '';
            let bindings: number[] = [];

            if (period === '24h') {
                whereClause = 'WHERE created_at > unixepoch() - 86400';
            } else if (period === '7d') {
                whereClause = 'WHERE created_at > unixepoch() - 604800';
            } else if (period === '30d') {
                whereClause = 'WHERE created_at > unixepoch() - 2592000';
            }

            const sql = `
                SELECT model, COUNT(*) as call_count, SUM(credit_cost) as total_credits
                FROM ai_usage_logs
                ${whereClause}
                GROUP BY model
                ORDER BY total_credits DESC
            `;

            const stmt = bindings.length > 0
                ? env.DB.prepare(sql).bind(...bindings)
                : env.DB.prepare(sql);

            const result = await stmt.all<UsageRow>();
            const rows = result.results ?? [];

            const byModel: AdminCostEntry[] = rows.map((row) => {
                const modelConfig = AI_MODEL_CONFIG[row.model as AIModels];
                return {
                    model: row.model,
                    modelName: modelConfig?.name ?? row.model,
                    provider: modelConfig?.provider ?? 'unknown',
                    callCount: row.call_count,
                    totalCredits: row.total_credits,
                    estimatedCostUsd: row.total_credits * CREDIT_TO_USD,
                };
            });

            const totalCredits = byModel.reduce((sum, e) => sum + e.totalCredits, 0);

            const data: AdminCostData = {
                period,
                totalCredits,
                estimatedCostUsd: totalCredits * CREDIT_TO_USD,
                byModel,
            };

            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error getting admin costs', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get cost data',
                500,
            );
        }
    }

    /**
     * GET /api/admin/users
     * Returns paginated user list with usage stats
     */
    static async getUsers(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const search = context.queryParams.get('search') ?? '';
            const page = Math.max(1, parseInt(context.queryParams.get('page') ?? '1', 10));
            const limit = Math.min(100, Math.max(1, parseInt(context.queryParams.get('limit') ?? '20', 10)));
            const sort = context.queryParams.get('sort') ?? 'createdAt';
            const order = context.queryParams.get('order') === 'asc' ? 'ASC' : 'DESC';
            const status = context.queryParams.get('status') ?? 'all';

            const offset = (page - 1) * limit;

            const sortColumnMap: Record<string, string> = {
                email: 'u.email',
                createdAt: 'u.created_at',
                lastActiveAt: 'u.last_active_at',
                appCount: 'app_count',
                credits: 'total_credits',
            };
            const sortColumn = sortColumnMap[sort] ?? 'u.created_at';

            const conditions: string[] = [];
            const bindValues: (string | number)[] = [];

            if (search) {
                conditions.push('(u.email LIKE ? OR u.display_name LIKE ?)');
                const searchPattern = `%${search}%`;
                bindValues.push(searchPattern, searchPattern);
            }

            if (status === 'active') {
                conditions.push('u.is_suspended = 0');
            } else if (status === 'suspended') {
                conditions.push('u.is_suspended = 1');
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            const dataBindValues = [...bindValues, limit, offset];
            const dataSql = `
                SELECT
                    u.id,
                    u.email,
                    u.display_name,
                    u.provider,
                    u.created_at,
                    u.last_active_at,
                    u.is_active,
                    u.is_suspended,
                    COUNT(DISTINCT a.id) as app_count,
                    COALESCE(SUM(ul.credit_cost), 0) as total_credits
                FROM users u
                LEFT JOIN apps a ON a.user_id = u.id
                LEFT JOIN ai_usage_logs ul ON ul.user_id = u.id
                ${whereClause}
                GROUP BY u.id
                ORDER BY ${sortColumn} ${order}
                LIMIT ? OFFSET ?
            `;

            const countSql = `
                SELECT COUNT(DISTINCT u.id) as total
                FROM users u
                ${whereClause}
            `;

            const [dataResult, countResult] = await Promise.all([
                env.DB.prepare(dataSql).bind(...dataBindValues).all<UserRow>(),
                env.DB.prepare(countSql).bind(...bindValues).first<CountRow>(),
            ]);

            const rows = dataResult.results ?? [];
            const total = countResult?.total ?? 0;

            const users: AdminUserEntry[] = rows.map((row) => ({
                id: row.id,
                email: row.email,
                displayName: row.display_name,
                provider: row.provider,
                createdAt: row.created_at ? new Date(row.created_at * 1000) : null,
                lastActiveAt: row.last_active_at ? new Date(row.last_active_at * 1000) : null,
                isActive: row.is_active === 1,
                isSuspended: row.is_suspended === 1,
                appCount: row.app_count,
                totalCredits: row.total_credits,
                hasKvOverride: false, // resolved client-side per-user via getUserKvStatus
            }));

            const data: AdminUsersData = {
                users,
                total,
                hasMore: offset + rows.length < total,
            };

            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error getting admin users', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get user list',
                500,
            );
        }
    }

    /**
     * GET /api/admin/users/:id/kv
     * Check if user has a KV override
     */
    static async getUserKvStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const userId = context.pathParams.id;
            if (!userId) {
                return AdminController.createErrorResponse('User ID required', 400);
            }

            const value = await env.VibecoderStore.get(`user_config:${userId}`);
            const data: AdminKvStatusData = { hasOverride: value !== null };
            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error getting user KV status', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get KV status',
                500,
            );
        }
    }

    /**
     * POST /api/admin/users/:id/suspend
     * Suspend a user account
     */
    static async suspendUser(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const userId = context.pathParams.id;
            if (!userId) {
                return AdminController.createErrorResponse('User ID required', 400);
            }

            await env.DB.prepare(
                'UPDATE users SET is_suspended = 1 WHERE id = ?'
            ).bind(userId).run();

            const data: AdminUserActionData = { success: true, message: 'User suspended' };
            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error suspending user', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to suspend user',
                500,
            );
        }
    }

    /**
     * POST /api/admin/users/:id/unsuspend
     * Unsuspend a user account
     */
    static async unsuspendUser(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const userId = context.pathParams.id;
            if (!userId) {
                return AdminController.createErrorResponse('User ID required', 400);
            }

            await env.DB.prepare(
                'UPDATE users SET is_suspended = 0 WHERE id = ?'
            ).bind(userId).run();

            const data: AdminUserActionData = { success: true, message: 'User unsuspended' };
            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error unsuspending user', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to unsuspend user',
                500,
            );
        }
    }

    /**
     * POST /api/admin/users/:id/upgrade
     * Upgrade user to Pro tier via KV override
     */
    static async upgradeUser(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const userId = context.pathParams.id;
            if (!userId) {
                return AdminController.createErrorResponse('User ID required', 400);
            }

            const overrideConfig = JSON.stringify({
                security: {
                    rateLimit: {
                        llmCalls: {
                            limit: 500,
                            dailyLimit: 200,
                        },
                    },
                },
            });

            await env.VibecoderStore.put(`user_config:${userId}`, overrideConfig);

            const data: AdminUserActionData = { success: true, message: 'User upgraded to Pro' };
            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error upgrading user', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to upgrade user',
                500,
            );
        }
    }

    /**
     * GET /api/admin/gateway-costs
     * Returns actual AI spend from Cloudflare AI Gateway analytics
     */
    static async getGatewayCosts(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const periodParam = context.queryParams.get('period') ?? '7d';
            const period = (['24h', '7d', '30d'] as const).includes(periodParam as '24h' | '7d' | '30d')
                ? (periodParam as '24h' | '7d' | '30d')
                : '7d';

            const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;

            const analytics = new AiGatewayAnalyticsService(env);
            const [result, minimax] = await Promise.all([
                analytics.getTotalAnalytics(days),
                AdminController.readMiniMaxCosts(env, days),
            ]);

            const data: AdminGatewayCostData = {
                period,
                totalCostUsd: result.totalCost,
                totalRequests: result.totalRequests,
                tokensIn: result.tokensIn,
                tokensOut: result.tokensOut,
                cacheHitRate: result.cacheHitRate,
                errorRate: result.errorRate,
                lastRequestAt: result.lastRequestAt,
                minimax,
            };

            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error getting gateway costs', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get gateway cost data',
                500,
            );
        }
    }

    private static async readMiniMaxCosts(env: Env, days: number): Promise<MiniMaxCostData | null> {
        const now = new Date();
        const keys = Array.from({ length: days }, (_, i) => {
            const d = new Date(now);
            d.setUTCDate(d.getUTCDate() - i);
            return `minimax_costs:${d.toISOString().split('T')[0]}`;
        });

        const results = await Promise.all(
            keys.map(k => env.VibecoderStore.get(k, 'json') as Promise<MiniMaxCostData | null>)
        );

        const valid = results.filter(Boolean) as MiniMaxCostData[];
        if (valid.length === 0) return null;

        return valid.reduce((acc, cur) => ({
            requests: acc.requests + cur.requests,
            tokensIn: acc.tokensIn + cur.tokensIn,
            tokensOut: acc.tokensOut + cur.tokensOut,
            costUsd: acc.costUsd + cur.costUsd,
        }), { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    }

    /**
     * POST /api/admin/users/:id/downgrade
     * Downgrade user by removing KV override
     */
    static async downgradeUser(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const userId = context.pathParams.id;
            if (!userId) {
                return AdminController.createErrorResponse('User ID required', 400);
            }

            await env.VibecoderStore.delete(`user_config:${userId}`);

            const data: AdminUserActionData = { success: true, message: 'User downgraded to free tier' };
            return AdminController.createSuccessResponse(data);
        } catch (error) {
            AdminController.logger.error('Error downgrading user', error);
            return AdminController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to downgrade user',
                500,
            );
        }
    }
}
