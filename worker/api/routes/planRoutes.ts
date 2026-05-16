import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';

import { PlanController } from '../controllers/plan/controller';

export function setupPlanRoutes(app: Hono<AppEnv>): void {
    app.post(
        '/api/generate-plan',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(PlanController, PlanController.generatePlan),
    );
}
