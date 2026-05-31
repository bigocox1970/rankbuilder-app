import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { SupabaseConnectOAuthProvider } from '../../../services/oauth/supabase-connect';
import { SupabaseConnectionService } from '../../../services/supabase/SupabaseConnectionService';
import { createLogger } from '../../../logger';
import { signState, verifyState } from '../../../utils/stateSigning';

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

            const state: SupabaseConnectState = { userId: user.id, timestamp: Date.now(), returnUrl };
            const signedState = await signState(state, env);
            const provider = SupabaseConnectOAuthProvider.create(env, baseUrl);
            const authUrl = await provider.getAuthorizationUrl(signedState);

            return new Response(null, {
                status: 302,
                headers: { Location: authUrl },
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
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            return Response.redirect(`${baseUrl}/settings?supabase=error&reason=${encodeURIComponent(error)}`, 302);
        }
        if (!code || !stateParam) {
            return Response.redirect(`${baseUrl}/settings?supabase=error&reason=missing_params`, 302);
        }

        const parsedState = await verifyState<SupabaseConnectState>(stateParam, env);
        if (!parsedState?.userId) {
            return Response.redirect(`${baseUrl}/settings?supabase=error&reason=invalid_state`, 302);
        }

        const absoluteReturnUrl = safeSameOriginUrl(parsedState.returnUrl, baseUrl);

        try {
            const provider = SupabaseConnectOAuthProvider.create(env, baseUrl);
            const tokens = await provider.exchangeCodeForTokens(code);
            if (!tokens.accessToken) {
                return Response.redirect(`${absoluteReturnUrl}?supabase=error&reason=token_exchange_failed`, 302);
            }

            const svc = new SupabaseConnectionService(env);
            await svc.saveConnection(parsedState.userId, tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

            const successUrl = new URL(absoluteReturnUrl);
            successUrl.searchParams.set('supabase', 'connected');
            return new Response(null, {
                status: 302,
                headers: { Location: successUrl.toString(), 'Referrer-Policy': 'no-referrer' },
            });
        } catch (err) {
            SupabaseConnectController.logger.error('Supabase OAuth callback failed', err);
            return Response.redirect(`${absoluteReturnUrl}?supabase=error&reason=callback_failed`, 302);
        }
    }

    static async getStatus(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const svc = new SupabaseConnectionService(env);
            // `connected` is the per-USER OAuth account (log in once). `linkedProject` is
            // per-APP (per agentId/chatId) — a project linked to one app must NOT show as
            // linked on others.
            const connection = await svc.getConnection(user.id);
            if (!connection) return SupabaseConnectController.createSuccessResponse({ connected: false });
            const chatId = new URL(request.url).searchParams.get('chatId') ?? undefined;
            const linked = chatId ? await svc.getLinkedProjectForAgent(chatId) : null;
            return SupabaseConnectController.createSuccessResponse({
                connected: true,
                linkedProject: linked
                    ? {
                        projectRef: linked.projectRef,
                        projectName: linked.projectName,
                        projectUrl: linked.projectUrl,
                        anonKey: linked.anonKey,
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
            const body = await request.json() as { projectRef: string; chatId?: string };
            if (!body.projectRef) return SupabaseConnectController.createErrorResponse('projectRef required', 400);
            if (!body.chatId) return SupabaseConnectController.createErrorResponse('chatId required', 400);

            const svc = new SupabaseConnectionService(env);
            const accessToken = await svc.getAccessToken(user.id);
            if (!accessToken) return SupabaseConnectController.createErrorResponse('Not connected to Supabase', 401);

            const projects = await svc.listProjects(accessToken);
            const project = projects.find(p => p.ref === body.projectRef);
            if (!project) return SupabaseConnectController.createErrorResponse('Project not found', 404);

            const keys = await svc.getProjectApiKeys(accessToken, body.projectRef);
            // Link to THIS app only (per-agent), not the whole user account.
            await svc.linkProjectForAgent(user.id, body.chatId, project, keys);

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
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) return SupabaseConnectController.createErrorResponse('Authentication required', 401);
        try {
            const svc = new SupabaseConnectionService(env);
            const chatId = new URL(request.url).searchParams.get('chatId') ?? undefined;
            // With chatId: unlink the project from THIS app only, leaving the user's OAuth
            // account (and other apps' links) intact. Without: full account disconnect.
            if (chatId) {
                await svc.unlinkAgent(chatId);
            } else {
                await svc.disconnect(user.id);
            }
            return SupabaseConnectController.createSuccessResponse({ disconnected: true });
        } catch (err) {
            SupabaseConnectController.logger.error('Error disconnecting Supabase', err);
            return SupabaseConnectController.createErrorResponse('Failed to disconnect', 500);
        }
    }
}
