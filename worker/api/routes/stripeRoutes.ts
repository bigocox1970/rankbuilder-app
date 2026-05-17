/**
 * Stripe Routes
 * Billing checkout, portal, and webhook endpoints
 */

import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StripeController } from '../controllers/stripe/controller';
import { CreditsController } from '../controllers/credits/controller';

export function setupStripeRoutes(app: Hono<AppEnv>): void {
    app.post(
        '/api/stripe/create-checkout',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(StripeController, StripeController.createCheckoutSession),
    );
    app.post(
        '/api/stripe/topup',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(StripeController, StripeController.createTopUpSession),
    );
    app.post(
        '/api/stripe/portal',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(StripeController, StripeController.createPortalSession),
    );
    // Webhook is public — Stripe signs with STRIPE_WEBHOOK_SECRET
    app.post(
        '/api/stripe/webhook',
        setAuthLevel(AuthConfig.public),
        adaptController(StripeController, StripeController.handleWebhook),
    );

    // Credits
    app.get(
        '/api/credits/balance',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CreditsController, CreditsController.getBalance),
    );
    app.post(
        '/api/credits/consume-build',
        setAuthLevel(AuthConfig.authenticated),
        adaptController(CreditsController, CreditsController.consumeBuild),
    );
}
