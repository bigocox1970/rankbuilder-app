import { BaseOAuthProvider } from './base';

export class SupabaseConnectOAuthProvider extends BaseOAuthProvider {
    protected readonly provider = 'supabase';
    protected readonly authorizationUrl = 'https://api.supabase.com/v1/oauth/authorize';
    protected readonly tokenUrl = 'https://api.supabase.com/v1/oauth/token';
    protected readonly userInfoUrl = '';
    protected readonly scopes = ['all'];
    protected readonly clientAuthMethod = 'basic' as const;

    // Supabase OAuth does not have a userInfo endpoint — we only need tokens
    async getUserInfo(_accessToken: string): Promise<never> {
        throw new Error('getUserInfo not applicable for Supabase connect flow');
    }

    static create(env: Env, baseUrl: string): SupabaseConnectOAuthProvider {
        if (!env.SUPABASE_CLIENT_ID || !env.SUPABASE_CLIENT_SECRET) {
            throw new Error('Supabase OAuth credentials not configured');
        }
        return new SupabaseConnectOAuthProvider(
            env.SUPABASE_CLIENT_ID,
            env.SUPABASE_CLIENT_SECRET,
            `${baseUrl}/api/integrations/supabase/callback`,
        );
    }
}
