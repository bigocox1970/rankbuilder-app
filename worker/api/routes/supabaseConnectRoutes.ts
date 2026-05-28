import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SupabaseConnectController } from '../controllers/supabaseConnect/controller';

export function setupSupabaseConnectRoutes(app: Hono<AppEnv>): void {
    // Initiate OAuth (authenticated — user must be logged in)
    app.get(
        '/api/integrations/supabase/connect',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.initiateConnect),
    );

    // OAuth callback (public — Supabase redirects here)
    app.get(
        '/api/integrations/supabase/callback',
        setAuthLevel(AuthConfig.public),
        adaptController(SupabaseConnectController, SupabaseConnectController.handleCallback),
    );

    // Connection status
    app.get(
        '/api/integrations/supabase/status',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.getStatus),
    );

    // List user's Supabase projects
    app.get(
        '/api/integrations/supabase/projects',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.listProjects),
    );

    // Link a specific project
    app.post(
        '/api/integrations/supabase/link-project',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.linkProject),
    );

    // Create new project
    app.post(
        '/api/integrations/supabase/create-project',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.createProject),
    );

    // Disconnect
    app.delete(
        '/api/integrations/supabase/disconnect',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(SupabaseConnectController, SupabaseConnectController.disconnect),
    );
}
