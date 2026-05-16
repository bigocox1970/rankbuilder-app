/**
 * Admin Routes
 * Admin-only endpoints for cost reporting and user management
 */

import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { AdminController } from '../controllers/admin/controller';

export function setupAdminRoutes(app: Hono<AppEnv>): void {
    // Cost dashboard
    app.get(
        '/api/admin/costs',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.getCosts),
    );

    // User management
    app.get(
        '/api/admin/users',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.getUsers),
    );

    // Per-user KV override status
    app.get(
        '/api/admin/users/:id/kv',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.getUserKvStatus),
    );

    // Suspend / unsuspend
    app.post(
        '/api/admin/users/:id/suspend',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.suspendUser),
    );

    app.post(
        '/api/admin/users/:id/unsuspend',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.unsuspendUser),
    );

    // Upgrade / downgrade (KV override)
    app.post(
        '/api/admin/users/:id/upgrade',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.upgradeUser),
    );

    app.post(
        '/api/admin/users/:id/downgrade',
        setAuthLevel(AuthConfig.adminOnly),
        adaptController(AdminController, AdminController.downgradeUser),
    );
}
