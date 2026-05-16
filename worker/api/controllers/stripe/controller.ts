/**
 * Stripe Controller
 * Handles checkout sessions, billing portal, and webhook processing
 */

import Stripe from 'stripe';
import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { UserService } from '../../../database/services/UserService';

const logger = createLogger('StripeController');

const PRO_KV_CONFIG = JSON.stringify({
    security: {
        rateLimit: {
            llmCalls: {
                limit: 500,
                dailyLimit: 500,
            },
        },
    },
});

function getStripe(env: Env): Stripe {
    return new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
    });
}

function getAppUrl(env: Env): string {
    return `https://app.${env.CUSTOM_PREVIEW_DOMAIN}`;
}

export class StripeController extends BaseController {
    static logger = createLogger('StripeController');

    /**
     * POST /api/stripe/create-checkout
     * Creates a Stripe checkout session and returns the redirect URL
     */
    static async createCheckoutSession(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) {
            return StripeController.createErrorResponse('Authentication required', 401);
        }

        try {
            const stripe = getStripe(env);
            const userService = new UserService(env);
            const dbUser = await userService.findUser({ id: user.id });

            let customerId = dbUser?.stripeCustomerId ?? undefined;
            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: { userId: user.id },
                });
                customerId = customer.id;
                await userService.updateStripeCustomer(user.id, customerId);
            }

            const appUrl = getAppUrl(env);
            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                customer: customerId,
                line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
                success_url: `${appUrl}/settings?billing=success`,
                cancel_url: `${appUrl}/settings`,
                client_reference_id: user.id,
            });

            return StripeController.createSuccessResponse({ url: session.url });
        } catch (error) {
            logger.error('Error creating checkout session', error);
            return StripeController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to create checkout session',
                500,
            );
        }
    }

    /**
     * POST /api/stripe/portal
     * Creates a Stripe billing portal session and returns the redirect URL
     */
    static async createPortalSession(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) {
            return StripeController.createErrorResponse('Authentication required', 401);
        }

        try {
            const stripe = getStripe(env);
            const userService = new UserService(env);
            const dbUser = await userService.findUser({ id: user.id });

            if (!dbUser?.stripeCustomerId) {
                return StripeController.createErrorResponse('No billing account found', 404);
            }

            const appUrl = getAppUrl(env);
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: dbUser.stripeCustomerId,
                return_url: `${appUrl}/settings`,
            });

            return StripeController.createSuccessResponse({ url: portalSession.url });
        } catch (error) {
            logger.error('Error creating portal session', error);
            return StripeController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to create portal session',
                500,
            );
        }
    }

    /**
     * POST /api/stripe/webhook
     * Receives and processes Stripe webhook events
     */
    static async handleWebhook(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<Response> {
        const signature = request.headers.get('stripe-signature');
        if (!signature) {
            return StripeController.createErrorResponse('Missing stripe-signature header', 400);
        }

        let event: Stripe.Event;
        try {
            const stripe = getStripe(env);
            const body = await request.text();
            event = await stripe.webhooks.constructEventAsync(
                body,
                signature,
                env.STRIPE_WEBHOOK_SECRET,
            );
        } catch (error) {
            logger.error('Webhook signature verification failed', error);
            return StripeController.createErrorResponse('Webhook signature invalid', 400);
        }

        try {
            const stripe = getStripe(env);
            const userService = new UserService(env);

            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object as Stripe.Checkout.Session;
                    const userId = session.client_reference_id;
                    if (!userId) break;

                    const customerId = typeof session.customer === 'string'
                        ? session.customer
                        : session.customer?.id ?? null;
                    const subscriptionId = typeof session.subscription === 'string'
                        ? session.subscription
                        : session.subscription?.id ?? null;

                    await userService.updateStripeSubscription(userId, {
                        customerId: customerId ?? undefined,
                        subscriptionId: subscriptionId ?? undefined,
                        status: 'active',
                    });
                    await env.VibecoderStore.put(`user_config:${userId}`, PRO_KV_CONFIG);
                    logger.info('User upgraded to Pro via checkout', { userId });
                    break;
                }

                case 'customer.subscription.updated': {
                    const sub = event.data.object as Stripe.Subscription;
                    const customer = await stripe.customers.retrieve(sub.customer as string);
                    if (customer.deleted) break;

                    const userId = (customer as Stripe.Customer).metadata?.userId;
                    if (!userId) break;

                    await userService.updateStripeSubscription(userId, {
                        subscriptionId: sub.id,
                        status: sub.status,
                    });

                    if (sub.status === 'active') {
                        await env.VibecoderStore.put(`user_config:${userId}`, PRO_KV_CONFIG);
                    } else {
                        await env.VibecoderStore.delete(`user_config:${userId}`);
                    }
                    break;
                }

                case 'customer.subscription.deleted': {
                    const sub = event.data.object as Stripe.Subscription;
                    const customer = await stripe.customers.retrieve(sub.customer as string);
                    if (customer.deleted) break;

                    const userId = (customer as Stripe.Customer).metadata?.userId;
                    if (!userId) break;

                    await userService.updateStripeSubscription(userId, {
                        subscriptionId: sub.id,
                        status: 'canceled',
                    });
                    await env.VibecoderStore.delete(`user_config:${userId}`);
                    logger.info('User downgraded from Pro', { userId });
                    break;
                }

                default:
                    logger.debug('Unhandled Stripe event', { type: event.type });
            }

            return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (error) {
            logger.error('Error processing webhook event', error);
            return StripeController.createErrorResponse('Webhook processing failed', 500);
        }
    }
}
