/**
 * Admin Controller Types
 */

export interface AdminCostEntry {
    model: string;
    modelName: string;
    provider: string;
    callCount: number;
    totalCredits: number;
    estimatedCostUsd: number;
}

export interface AdminCostData {
    period: '24h' | '7d' | '30d' | 'all';
    totalCredits: number;
    estimatedCostUsd: number;
    byModel: AdminCostEntry[];
}

export interface AdminUserEntry {
    id: string;
    email: string;
    displayName: string;
    provider: string;
    createdAt: Date | null;
    lastActiveAt: Date | null;
    isActive: boolean;
    isSuspended: boolean;
    appCount: number;
    totalCredits: number;
    hasKvOverride: boolean;
}

export interface AdminUsersData {
    users: AdminUserEntry[];
    total: number;
    hasMore: boolean;
}

export interface AdminUserActionData {
    success: boolean;
    message: string;
}

export interface AdminKvStatusData {
    hasOverride: boolean;
}

export interface MiniMaxCostData {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
}

export interface AdminGatewayCostData {
    period: '24h' | '7d' | '30d';
    totalCostUsd: number;
    totalRequests: number;
    tokensIn: number;
    tokensOut: number;
    cacheHitRate: number;
    errorRate: number;
    lastRequestAt: string | null;
    minimax: MiniMaxCostData | null;
}
