import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { SupabaseConnectOAuthProvider } from '../../../services/oauth/supabase-connect';
import { BaseOAuthProvider } from '../../../services/oauth/base';
import { SupabaseConnectionService } from '../../../services/supabase/SupabaseConnectionService';
import { createLogger } from '../../../logger';
import { signState, verifyState } from '../../../utils/stateSigning';
import { buildVerifierCookie, buildClearVerifierCookie, readVerifierCookie } from '../../../utils/oauthCookie';

interface SupabaseConnectState {
    userId: string;
    timestamp: number;
    returnUrl: string;
}

function safeSameOriginUrl(candidate: string | undefined | null, baseUrl: string): string {
    const fallback = `${baseUrl}/settings?tab=integrations`;
    if (!candidate) return fallback;
    try {
        const resolved = new URL(candidate, baseUrl);
        return resolved.origin === new URL(baseUrl).origin ? resolved.toString() : fallback;
    } catch {
        return fallback;
    }
}

export class SupabaseConnectController extends BaseController {
    static logger = createLogger('SupabaseConnectController');

    static async initiateConnect(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const user = context.user;
            if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);

            const fetchSite = request.headers.get('Sec-Fetch-Site');
            if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
                return SupabaseConnectController.createErrorResponse('Cross-site request blocked', 403);
            }

            const url = new URL(request.url);
            const baseUrl = url.origin;
            const returnUrl = safeSameOriginUrl(
                context.queryParams.get('return_url') || request.headers.get('referer'),
                baseUrl,
            );

            if (!env.SUPABASE_CLIENT_ID || !env.SUPABASE_CLIENT_SECRET) {
                return Response.redirect(`${returnUrl}?supabase=error&reason=not_configured`, 302);
            }

            const codeVerifier = BaseOAuthProvider.generateCodeVerifier();
            const state: SupabaseConnectState = { userId: user.id, timestamp: Date.now(), returnUrl };
            const signedState = await signState(state, env);
            const provider = SupabaseConnectOAuthProvider.create(env, baseUrl);
            const authUrl = await provider.getAuthorizationUrl(signedState, codeVerifier);

            return new Response(null, {
                status: 302,
                headers: {
                    Location: authUrl,
                    'Set-Cookie': buildVerifierCookie(env, codeVerifier),
                },
            });
        } catch (error) {
            SupabaseConnectController.logger.error('Failed to initiate Supabase connect', error);
            return Response.redirect(`${new URL(request.url).origin}/settings?supabase=error&reason=init_failed`, 302);
        }
    }

    static async handleCallback(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<Response> {
        const url = new URL(request.url);
        const baseUrl = url.origin;
        const clearVerifierCookie = buildClearVerifierCookie(env);
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${baseUrl}/settings?supabase=error&reason=${encodeURIComponent(error)}`, 'Set-Cookie': clearVerifierCookie },
            });
        }
        if (!code || !stateParam) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${baseUrl}/settings?supabase=error&reason=missing_params`, 'Set-Cookie': clearVerifierCookie },
            });
        }

        const parsedState = await verifyState<SupabaseConnectState>(stateParam, env);
        if (!parsedState?.userId) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${baseUrl}/settings?supabase=error&reason=invalid_state`, 'Set-Cookie': clearVerifierCookie },
            });
        }

        const absoluteReturnUrl = safeSameOriginUrl(parsedState.returnUrl, baseUrl);
        const codeVerifier = readVerifierCookie(request);
        if (!codeVerifier) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${absoluteReturnUrl}?supabase=error&reason=missing_verifier`, 'Set-Cookie': clearVerifierCookie },
            });
        }

        try {
            const provider = SupabaseConnectOAuthProvider.create(env, baseUrl);
            const tokens = await provider.exchangeCodeForTokens(code, codeVerifier);
            if (!tokens.accessToken) {
                return new Response(null, {
                    status: 302,
                    headers: { Location: `${absoluteReturnUrl}?supabase=error&reason=token_exchange_failed`, 'Set-Cookie': clearVerifierCookie },
                });
            }

            const svc = new SupabaseConnectionService(env);
            await svc.saveConnection(parsedState.userId, tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

            const successUrl = new URL(absoluteReturnUrl);
            successUrl.searchParams.set('supabase', 'connected');

            const headers = new Headers();
            headers.set('Location', successUrl.toString());
            headers.append('Set-Cookie', clearVerifierCookie);
            headers.set('Referrer-Policy', 'no-referrer');
            return new Response(null, { status: 302, headers });
        } catch (err) {
            SupabaseConnectController.logger.error('Supabase OAuth callback failed', err);
            return new Response(null, {
                status: 302,
                headers: { Location: `${absoluteReturnUrl}?supabase=error&reason=callback_failed`, 'Set-Cookie': clearVerifierCookie },
            });
        }
    }

    static async getStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const svc = new SupabaseConnectionService(env);
            const connection = await svc.getConnection(user.id);
            if (!connection) return SupabaseConnectController.createSuccessResponse({ connected: false });
            return SupabaseConnectController.createSuccessResponse({
                connected: true,
                linkedProject: connection.projectRef
                    ? {
                        projectRef: connection.projectRef,
                        projectName: connection.projectName,
                        projectUrl: connection.projectUrl,
                        anonKey: connection.anonKey,
                    }
                    : null,
            });
        } catch (err) {
            SupabaseConnectController.logger.error('Error getting Supabase status', err);
            return SupabaseConnectController.createErrorResponse('Failed to get connection status', 500);
        }
    }

    static async listProjects(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const svc = new SupabaseConnectionService(env);
            const accessToken = await svc.getAccessToken(user.id);
            if (!accessToken) return SupabaseConnectController.createErrorResponse('Not connected to Supabase', 401);
            const projects = await svc.listProjects(accessToken);
            return SupabaseConnectController.createSuccessResponse({ projects });
        } catch (err) {
            SupabaseConnectController.logger.error('Error listing Supabase projects', err);
            return SupabaseConnectController.createErrorResponse('Failed to list projects', 500);
        }
    }

    static async linkProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const body = await request.json() as { projectRef: string };
            if (!body.projectRef) return SupabaseConnectController.createErrorResponse('projectRef required', 400);

            const svc = new SupabaseConnectionService(env);
            const accessToken = await svc.getAccessToken(user.id);
            if (!accessToken) return SupabaseConnectController.createErrorResponse('Not connected to Supabase', 401);

            const projects = await svc.listProjects(accessToken);
            const project = projects.find(p => p.ref === body.projectRef);
            if (!project) return SupabaseConnectController.createErrorResponse('Project not found', 404);

            const keys = await svc.getProjectApiKeys(accessToken, body.projectRef);
            await svc.linkProject(user.id, project, keys);

            return SupabaseConnectController.createSuccessResponse({
                projectRef: project.ref,
                projectName: project.name,
                projectUrl: keys.projectUrl,
                anonKey: keys.anonKey,
            });
        } catch (err) {
            SupabaseConnectController.logger.error('Error linking Supabase project', err);
            return SupabaseConnectController.createErrorResponse('Failed to link project', 500);
        }
    }

    static async createProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const body = await request.json() as { name: string; region: string };
            if (!body.name?.trim()) return SupabaseConnectController.createErrorResponse('name required', 400);

            const svc = new SupabaseConnectionService(env);
            const accessToken = await svc.getAccessToken(user.id);
            if (!accessToken) return SupabaseConnectController.createErrorResponse('Not connected to Supabase', 401);

            // Get first org to create project in
            const orgs = await svc.listOrganizations(accessToken);
            if (!orgs.length) return SupabaseConnectController.createErrorResponse('No Supabase organization found', 400);

            const project = await svc.createProject(accessToken, body.name.trim(), body.region ?? 'us-east-1', orgs[0].id);
            return SupabaseConnectController.createSuccessResponse({ ref: project.ref, name: project.name });
        } catch (err) {
            SupabaseConnectController.logger.error('Error creating Supabase project', err);
            const msg = err instanceof Error ? err.message : 'Failed to create project';
            return SupabaseConnectController.createErrorResponse(msg, 500);
        }
    }

    static async disconnect(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const svc = new SupabaseConnectionService(env);
            await svc.disconnect(user.id);
            return SupabaseConnectController.createSuccessResponse({ disconnected: true });
        } catch (err) {
            SupabaseConnectController.logger.error('Error disconnecting Supabase', err);
            return SupabaseConnectController.createErrorResponse('Failed to disconnect', 500);
        }
    }
}
