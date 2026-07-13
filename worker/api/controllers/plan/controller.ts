/**
 * Plan Controller
 * Generates a structured site plan from a business description before the main build begins.
 * Uses Gemini Flash for fast, cheap plan generation.
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { successResponse } from '../../responses';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import type { SiteContentPlan, SiteTheme, SiteFont } from '../agent/types';

const logger = createLogger('PlanController');

const THEMES: SiteTheme[] = ['ledger', 'espresso', 'atelier', 'neon-terminal', 'cobalt-civic', 'sandstone', 'orchard', 'velvet', 'slate-brut', 'bloom', 'harbor', 'midnight-gold'];
const FONTS: SiteFont[] = ['courthouse', 'roast', 'gallery', 'console', 'civic', 'loam', 'market', 'boudoir', 'concrete', 'petal', 'tide', 'regalia'];
const WIREFRAMES = ['service-local', 'restaurant', 'portfolio', 'saas-landing', 'shop-lite', 'personal-brand', 'event', 'clinic', 'nonprofit', 'real-estate', 'fitness', 'editorial'];

const PLAN_SYSTEM_PROMPT = `You are a professional web design consultant creating a content brief for a business website.
Return ONLY valid JSON. No markdown fences, no explanation, no extra text — just the raw JSON object.

The plan must include EXACTLY 6 services. Each image prompt must describe a real-world photograph suitable for AI image generation — vivid physical scenes, no text, no logos, no UI/screens.

CRITICAL — REAL DATA EXTRACTION (the "realData" field):
The business description may contain REAL assets: image URLs (photos, logos), real customer reviews, and verified business facts (ratings, review counts, phone numbers, guarantees, service areas, profile links). Extract them into "realData" VERBATIM:
- images: every image URL found, copied character-for-character (including query strings), with a short title of what it shows (from surrounding text) and a role: logo | hero | project | gallery.
- reviews: every customer review quoted in the description, text copied VERBATIM — do not paraphrase, shorten, or fix grammar — with its score and attribution exactly as given.
- facts: rating, review count, review-source URL, phone, service areas, guarantee, member-since — ONLY values explicitly stated in the description. Include email ONLY if explicitly given. NEVER invent, estimate, or embellish any value. Omit any key not present.
If the description contains none of these, omit "realData" entirely.

Available colour themes (pick the one that best fits the business personality):
ledger (pine-green + ivory — accountants, law, finance, trust), espresso (roasted browns — cafés, bakeries, artisan food), atelier (warm neutrals + vermilion — studios, designers, editorial), neon-terminal (phosphor-green on black — SaaS, dev tools, tech), cobalt-civic (deep cobalt — fintech, B2B, engineering), sandstone (desert clay — wellness, yoga, ceramics, slow living), orchard (persimmon-red — restaurants, markets, food), velvet (wine-plum + orchid — beauty, nightlife, premium brands), slate-brut (concrete + safety-orange — agencies, portfolios, bold brands), bloom (blush + rose — florists, boutiques, beauty), harbor (sea-teal — clinics, travel, coastal hospitality), midnight-gold (black + antique gold — law, fine dining, luxury).

Available font pairings:
courthouse (Caslon display + Public Sans — establishment authority), roast (Fraunces + Nunito — friendly artisan), gallery (Playfair + Spline — magazine elegance), console (Space Mono + IBM Plex — engineered precision), civic (Libre Franklin + IBM Plex — institutional legible), loam (Newsreader + Hanken — calm grounded), market (Bricolage + Work Sans — lively appetising), boudoir (Bodoni + Albert — high-fashion sensual), concrete (Archivo Black + Archivo — loud structural), petal (Gloock + Mulish — delicate boutique), tide (Schibsted + Karla — clean modern), regalia (Cormorant + Be Vietnam — timeless expensive).

Available wireframe layouts (choose the one that best fits the business type):
service-local (credibility-first local business — trust badges, services, contact form), restaurant (atmosphere-led — carousel hero, menu, gallery, map), portfolio (work-first — gallery, about, services), saas-landing (conversion funnel — features, how-it-works, pricing, FAQ), shop-lite (merchandising — featured products, categories, newsletter), personal-brand (person-forward — portrait hero, story, booking), event (date-driven — agenda, speakers, map, register), clinic (reassurance + booking — services, team, booking form), nonprofit (mission-led — cause, impact stats, donate CTA), real-estate (search-first — property search, listings, agent trust), fitness (energy + commitment — programs, schedule, pricing), editorial (content-forward — featured story, categories, newsletter).

Choose the theme, font, and wireframe that best fit the business personality and type.`;

function buildPlanPrompt(description: string, keywords: string[]): string {
    const kwLine = keywords.length > 0 ? `\nTarget keywords: ${keywords.join(', ')}` : '';
    return `Business description: "${description}"${kwLine}

Generate a complete website content plan as JSON matching this exact structure:
{
  "tagline": "Short punchy tagline, max 8 words",
  "tone": "One of: professional, friendly, premium, urgent",
  "theme": "One of: ledger | espresso | atelier | neon-terminal | cobalt-civic | sandstone | orchard | velvet | slate-brut | bloom | harbor | midnight-gold",
  "font": "One of: courthouse | roast | gallery | console | civic | loam | market | boudoir | concrete | petal | tide | regalia",
  "wireframe": "One of: service-local | restaurant | portfolio | saas-landing | shop-lite | personal-brand | event | clinic | nonprofit | real-estate | fitness | editorial",
  "pageStructure": "single or multi — single for simple local businesses (one trade, one location, fewer than 6 services); multi for businesses with multiple distinct service areas, locations, or strong SEO needs (law firms, agencies, clinics, businesses explicitly wanting SEO)",
  "hero": {
    "headline": "Main H1 heading, max 10 words, include location if mentioned",
    "subheadline": "Supporting line, max 20 words",
    "cta": "Call-to-action button text, 2-4 words",
    "imagePrompt": "Vivid real-world photograph — wide angle interior or action shot, no text, no signs, no signage, no storefronts, no shop fronts, no branded facades, photorealistic"
  },
  "about": {
    "title": "About section heading, max 8 words",
    "body": "About paragraph, 50-80 words, first person, specific to the trade",
    "imagePrompt": "Vivid real-world photograph — professional at work or finished result, natural light, no text, no signs, no signage, no storefronts"
  },
  "services": [
    {
      "title": "Specific service name, 2-5 words",
      "description": "What this service includes, 15-25 words",
      "imagePrompt": "Vivid real-world photograph specific to this exact service — completed work, tools, materials, or environment. No text, no signs, no signage, no storefronts, no shop fronts"
    }
  ],
  "realData": {
    "images": [{ "url": "exact URL verbatim", "title": "what it shows", "role": "logo | hero | project | gallery" }],
    "reviews": [{ "score": "e.g. 10/10", "title": "review title if given", "text": "VERBATIM review text", "attribution": "e.g. Verified Checkatrade review · Maidenhead (SL6)" }],
    "facts": { "rating": "e.g. 9.92/10", "reviewCount": 40, "reviewSourceUrl": "profile URL", "phone": "as given", "serviceAreas": ["as", "given"], "guarantee": "as given", "memberSince": "as given", "other": ["any other verbatim facts"] }
  }
}

Write exactly 6 service entries. Make EVERYTHING specific to this exact business — no generic filler. Image prompts must describe real physical scenes that clearly represent that service. The "realData" field is extraction-only: verbatim copies of what's in the description, or omitted if absent.`;
}

export class PlanController extends BaseController {
    /**
     * POST /api/generate-plan
     * Accepts { description, keywords? } and returns a SiteContentPlan.
     */
    static async generatePlan(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const body = await request.json() as { description?: string; keywords?: string[]; agentId?: string };
            const description = (body.description ?? '').trim();
            if (!description) {
                return Response.json({ error: 'description is required' }, { status: 400 });
            }
            const keywords: string[] = Array.isArray(body.keywords) ? body.keywords : [];

            const apiKey = env.GOOGLE_AI_STUDIO_API_KEY;
            if (!apiKey) {
                logger.error('GOOGLE_AI_STUDIO_API_KEY not configured');
                return Response.json({ error: 'AI not configured' }, { status: 500 });
            }

            // Credit deduction — plan generation uses Flash Lite (creditCost 0.4 rounded to 1).
            if (context.user?.id) {
                try {
                    await RateLimitService.deductCredits(env, context.user.id, 1, 'site plan generation');
                } catch (e) {
                    return Response.json({ error: e instanceof Error ? e.message : 'Out of credits' }, { status: 402 });
                }
            }

            const prompt = buildPlanPrompt(description, keywords);

            const gatewayBase = (env.CLOUDFLARE_AI_GATEWAY_URL
                || `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY}`).replace(/\/+$/, '');
            const planUrl = `${gatewayBase}/google-ai-studio/v1beta/openai/chat/completions`;

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'cf-aig-metadata': JSON.stringify({
                    chatId: body.agentId ?? 'pre-agent',
                    userId: context.user?.id ?? 'anonymous',
                    actionKey: 'planGeneration',
                }),
            };
            if (env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
                headers['cf-aig-authorization'] = `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}`;
            }

            const geminiResponse = await fetch(planUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'gemini-2.5-flash-lite',
                    messages: [
                        { role: 'system', content: PLAN_SYSTEM_PROMPT },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7,
                    // Raised from 2048: realData (verbatim reviews + image URLs) needs headroom.
                    max_tokens: 6144,
                }),
            });

            if (!geminiResponse.ok) {
                const errText = await geminiResponse.text();
                logger.error('Gemini plan generation failed', { status: geminiResponse.status, errText });
                return Response.json({ error: 'Plan generation failed' }, { status: 502 });
            }

            const geminiData = await geminiResponse.json() as {
                choices?: Array<{ message?: { content?: string } }>;
            };
            const raw = geminiData.choices?.[0]?.message?.content ?? '';

            // Strip any accidental markdown fences
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

            let plan: SiteContentPlan;
            try {
                plan = JSON.parse(cleaned) as SiteContentPlan;
            } catch {
                logger.error('Failed to parse plan JSON from Gemini', { raw });
                return Response.json({ error: 'Failed to parse plan response' }, { status: 502 });
            }

            // Validate/fallback theme and font
            if (!THEMES.includes(plan.theme as SiteTheme)) {
                logger.warn('Invalid theme from plan, defaulting to ledger', { theme: plan.theme });
                plan.theme = 'ledger';
            }
            if (!FONTS.includes(plan.font as SiteFont)) {
                logger.warn('Invalid font from plan, defaulting to courthouse', { font: plan.font });
                plan.font = 'courthouse';
            }
            if (plan.wireframe && !WIREFRAMES.includes(plan.wireframe)) {
                logger.warn('Invalid wireframe from plan, clearing', { wireframe: plan.wireframe });
                plan.wireframe = undefined;
            }

            if (!Array.isArray(plan.services) || plan.services.length < 6) {
                logger.warn('Plan has fewer than 6 services', { count: plan.services?.length });
            }

            // Sanitise realData: keep only http(s) image URLs that literally appear in the
            // user's description (guards against hallucinated URLs), drop empty reviews.
            if (plan.realData) {
                if (Array.isArray(plan.realData.images)) {
                    plan.realData.images = plan.realData.images.filter(img =>
                        typeof img?.url === 'string'
                        && /^https?:\/\//i.test(img.url)
                        && description.includes(img.url.split('?')[0])
                    );
                    if (plan.realData.images.length === 0) plan.realData.images = undefined;
                }
                if (Array.isArray(plan.realData.reviews)) {
                    plan.realData.reviews = plan.realData.reviews.filter(r => typeof r?.text === 'string' && r.text.trim().length > 0);
                    if (plan.realData.reviews.length === 0) plan.realData.reviews = undefined;
                }
                if (!plan.realData.images && !plan.realData.reviews && !plan.realData.facts) {
                    plan.realData = undefined;
                }
                logger.info('Plan realData extracted', {
                    images: plan.realData?.images?.length ?? 0,
                    reviews: plan.realData?.reviews?.length ?? 0,
                    hasFacts: !!plan.realData?.facts,
                });
            }

            return successResponse({ plan });
        } catch (error) {
            logger.error('Error in generatePlan', { error });
            return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
    }
}
