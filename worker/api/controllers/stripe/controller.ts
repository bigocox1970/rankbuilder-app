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

// Credit packs (frontend amount → KV credit count)
const TOPUP_PACKS: Record<string, { credits: number; label: string }> = {
    '10': { credits: 400, label: 'Top-up · 400 credits' },
    '20': { credits: 1000, label: 'Top-up · 1,000 credits' },
    '50': { credits: 2500, label: 'Top-up · 2,500 credits' },
};

// Pro subscription monthly credit refresh (added each renewal period)
const PRO_MONTHLY_CREDITS = 1500;

function topupPriceId(env: Env, amount: '10' | '20' | '50'): string | undefined {
    if (amount === '10') return env.STRIPE_TOPUP_PRICE_10;
    if (amount === '20') return env.STRIPE_TOPUP_PRICE_20;
    if (amount === '50') return env.STRIPE_TOPUP_PRICE_50;
    return undefined;
}

async function addCredits(env: Env, userId: string, amount: number): Promise<number> {
    const key = `user_credits:${userId}`;
    const current = parseInt((await env.VibecoderStore.get(key)) ?? '0', 10);
    const next = current + amount;
    await env.VibecoderStore.put(key, String(next));
    return next;
}

function getStripe(env: Env): Stripe {
    return new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
    });
}

export interface AdminBillingSubscription {
    id: string;
    status: string;
    amount: number | null;
    currency: string | null;
    interval: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
}

export interface AdminBillingPayment {
    id: string;
    amount: number;
    currency: string;
    status: string;
    description: string | null;
    created: number;
}

export interface AdminBillingSummary {
    subscription: AdminBillingSubscription | null;
    payments: AdminBillingPayment[];
    error: string | null;
}

/**
 * Best-effort billing summary for the admin user-detail view: the live Stripe
 * subscription (plan/amount/renewal) and the user's one-time payment history
 * (there is no local payments table — Stripe is the source of truth). Never
 * throws; on any Stripe error it returns what it has plus an `error` note so the
 * admin view still renders the rest of the user's profile.
 */
export async function getAdminBillingSummary(
    env: Env,
    customerId: string | null | undefined,
    subscriptionId: string | null | undefined,
): Promise<AdminBillingSummary> {
    if (!customerId) {
        return { subscription: null, payments: [], error: null };
    }
    const stripe = getStripe(env);
    let subscription: AdminBillingSubscription | null = null;
    const payments: AdminBillingPayment[] = [];
    let error: string | null = null;
    try {
        if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const item = sub.items?.data?.[0];
            const price = item?.price;
            subscription = {
                id: sub.id,
                status: sub.status,
                amount: price?.unit_amount ?? null,
                currency: price?.currency ?? null,
                interval: price?.recurring?.interval ?? null,
                // current_period_end moved to the subscription item in recent Stripe API versions.
                currentPeriodEnd: item?.current_period_end ?? null,
                cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
            };
        }
        const charges = await stripe.charges.list({ customer: customerId, limit: 20 });
        for (const ch of charges.data) {
            payments.push({
                id: ch.id,
                amount: ch.amount,
                currency: ch.currency,
                status: ch.status,
                description: ch.description ?? null,
                created: ch.created,
            });
        }
    } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load Stripe billing';
    }
    return { subscription, payments, error };
}

function getAppUrl(env: Env): string {
    return `https://app.${env.CUSTOM_PREVIEW_DOMAIN}`;
}

/**
 * Returns a valid Stripe customer ID for the user in the current Stripe mode (live or test).
 * If a stored ID doesn't resolve (e.g. it was created in Sandbox/test mode but we're now on live keys),
 * a new customer is created and persisted, replacing the stale ID.
 */
async function ensureStripeCustomer(
    stripe: Stripe,
    userService: UserService,
    userId: string,
    email: string,
    storedId: string | undefined,
): Promise<string> {
    if (storedId) {
        try {
            const existing = await stripe.customers.retrieve(storedId);
            if (!existing.deleted) return storedId;
        } catch (e) {
            const code = (e as { code?: string })?.code;
            if (code !== 'resource_missing') throw e;
        }
    }
    const customer = await stripe.customers.create({ email, metadata: { userId } });
    await userService.updateStripeCustomer(userId, customer.id);
    return customer.id;
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

            const customerId = await ensureStripeCustomer(
                stripe,
                userService,
                user.id,
                user.email,
                dbUser?.stripeCustomerId ?? undefined,
            );

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
     * POST /api/stripe/topup
     * One-time credit purchase. Body: { amount: '10' | '20' | '50' }
     */
    static async createTopUpSession(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        const user = context.user;
        if (!user) {
            return StripeController.createErrorResponse('Authentication required', 401);
        }

        const body = await request.json().catch(() => ({})) as { amount?: string };
        const amount = body.amount;
        if (amount !== '10' && amount !== '20' && amount !== '50') {
            return StripeController.createErrorResponse('Invalid top-up amount', 400);
        }
        const priceId = topupPriceId(env, amount);
        if (!priceId) {
            return StripeController.createErrorResponse('Top-up price not configured', 500);
        }
        const pack = TOPUP_PACKS[amount];

        try {
            const stripe = getStripe(env);
            const userService = new UserService(env);
            const dbUser = await userService.findUser({ id: user.id });

            const customerId = await ensureStripeCustomer(
                stripe,
                userService,
                user.id,
                user.email,
                dbUser?.stripeCustomerId ?? undefined,
            );

            const appUrl = getAppUrl(env);
            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                customer: customerId,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${appUrl}/settings?topup=success`,
                cancel_url: `${appUrl}/settings`,
                client_reference_id: user.id,
                metadata: {
                    type: 'topup',
                    userId: user.id,
                    credits: String(pack.credits),
                },
            });

            return StripeController.createSuccessResponse({ url: session.url });
        } catch (error) {
            logger.error('Error creating top-up session', error);
            return StripeController.createErrorResponse(
                error instanceof Error ? error.message : 'Failed to create top-up session',
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

            // Verify the stored customer ID exists in the current Stripe mode.
            // (A Sandbox/test-mode ID won't resolve once we're on live keys.)
            try {
                const existing = await stripe.customers.retrieve(dbUser.stripeCustomerId);
                if (existing.deleted) {
                    return StripeController.createErrorResponse('No billing account found', 404);
                }
            } catch (e) {
                const code = (e as { code?: string })?.code;
                if (code === 'resource_missing') {
                    return StripeController.createErrorResponse('No billing account found', 404);
                }
                throw e;
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

                    // Top-up purchase (one-time payment)
                    if (session.metadata?.type === 'topup') {
                        const credits = parseInt(session.metadata.credits ?? '0', 10);
                        if (credits > 0) {
                            const newBalance = await addCredits(env, userId, credits);
                            logger.info('Credits added via top-up', { userId, credits, newBalance });
                        }
                        break;
                    }

                    // Subscription checkout (recurring) — initial Pro signup grants first month's credits
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
                    const newBalance = await addCredits(env, userId, PRO_MONTHLY_CREDITS);
                    logger.info('Pro subscription started, monthly credits granted', { userId, credits: PRO_MONTHLY_CREDITS, newBalance });
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object as Stripe.Invoice;
                    // Only credit on actual monthly renewals (not the initial signup, which is handled by checkout.session.completed)
                    if (invoice.billing_reason !== 'subscription_cycle') break;

                    const customerId = typeof invoice.customer === 'string'
                        ? invoice.customer
                        : invoice.customer?.id ?? null;
                    if (!customerId) break;

                    const customer = await stripe.customers.retrieve(customerId);
                    if (customer.deleted) break;

                    const userId = (customer as Stripe.Customer).metadata?.userId;
                    if (!userId) break;

                    const newBalance = await addCredits(env, userId, PRO_MONTHLY_CREDITS);
                    logger.info('Pro subscription renewed, monthly credits granted', { userId, credits: PRO_MONTHLY_CREDITS, newBalance });
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
