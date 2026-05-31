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
    creditBalance: number;
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

export interface AdminGrantCreditsData {
    success: boolean;
    message: string;
    newBalance: number;
}

export interface AdminUserAppEntry {
    id: string;
    title: string;
    framework: string | null;
    status: string;
    visibility: string;
    deploymentId: string | null;
    createdAt: Date | null;
}

export interface AdminUserUsageEntry {
    model: string;
    agentAction: string | null;
    creditCost: number;
    createdAt: Date | null;
}

export interface AdminBillingSubscriptionData {
    id: string;
    status: string;
    amount: number | null;
    currency: string | null;
    interval: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
}

export interface AdminBillingPaymentData {
    id: string;
    amount: number;
    currency: string;
    status: string;
    description: string | null;
    created: number;
}

export interface AdminUserDetailData {
    id: string;
    email: string;
    displayName: string;
    provider: string;
    createdAt: Date | null;
    lastActiveAt: Date | null;
    isActive: boolean;
    isSuspended: boolean;
    // Credits
    creditBalance: number;
    creditsUsed: number;
    usageCallCount: number;
    recentUsage: AdminUserUsageEntry[];
    // Apps
    appCount: number;
    apps: AdminUserAppEntry[];
    // Plan / billing
    hasProOverride: boolean;
    stripeCustomerId: string | null;
    stripeSubscriptionStatus: string | null;
    subscription: AdminBillingSubscriptionData | null;
    payments: AdminBillingPaymentData[];
    billingError: string | null;
}

export interface AdminMagicLinkData {
    link: string;
    expiresInSeconds: number;
}

export interface AdminKvStatusData {
    hasOverride: boolean;
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
}
