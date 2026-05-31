import { BaseOAuthProvider } from './base';
import type { OAuthUserInfo } from '../../types/auth-types';

export class SupabaseConnectOAuthProvider extends BaseOAuthProvider {
    protected readonly provider = 'supabase';
    protected readonly authorizationUrl = 'https://api.supabase.com/v1/oauth/authorize';
    protected readonly tokenUrl = 'https://api.supabase.com/v1/oauth/token';
    protected readonly userInfoUrl = '';
    // `organizations` is needed to list orgs when CREATING a project (projects write +
    // organizations read must also be granted on the Supabase OAuth app itself).
    protected readonly scopes = ['projects', 'secrets', 'organizations'];
    protected readonly clientAuthMethod = 'basic' as const;

    // Override to use a clean minimal OAuth URL — no Google-specific params, no PKCE
    // (this is a confidential server-side client; PKCE is for public clients)
    async getAuthorizationUrl(state: string): Promise<string> {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: this.scopes.join(' '),
            state,
        });
        return `${this.authorizationUrl}?${params.toString()}`;
    }

    async getUserInfo(_accessToken: string): Promise<OAuthUserInfo> {
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
