/**
 * Plan Controller
 * Generates a structured site plan from a business description before the main build begins.
 * Uses Gemini Flash for fast, cheap plan generation.
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { successResponse } from '../../responses';
import type { SiteContentPlan, SiteTheme, SiteFont } from '../agent/types';

const logger = createLogger('PlanController');

const THEMES: SiteTheme[] = ['craftsman', 'industrial', 'luxury-green', 'security', 'agency', 'parchment', 'editorial', 'ivory'];
const FONTS: SiteFont[] = ['inter', 'playfair', 'lora', 'montserrat', 'cormorant'];

const PLAN_SYSTEM_PROMPT = `You are a professional web design consultant creating a content brief for a tradesperson website.
Return ONLY valid JSON. No markdown fences, no explanation, no extra text — just the raw JSON object.

The plan must include EXACTLY 6 services. Each image prompt must describe a real-world photograph suitable for AI image generation — vivid physical scenes, no text, no logos, no UI/screens.

Available themes: craftsman (warm dark wood tones — builders, carpenters, general trades), industrial (cool steel/slate — plumbers, HVAC, engineers), luxury-green (deep forest green — landscapers, gardeners, premium services), security (navy/dark blue — security, electrical, alarms), agency (bold dark — marketing, tech, modern services), parchment (warm neutral — antiques, restoration, heritage trades), editorial (light cream — consultants, designers, premium B2B), ivory (warm light — florists, interior design, premium domestic).

Available fonts: inter (clean modern sans-serif), playfair (elegant serif for premium), lora (readable editorial serif), montserrat (bold geometric sans-serif), cormorant (refined luxury serif).

Choose the theme and font that best fit the business personality.`;

function buildPlanPrompt(description: string, keywords: string[]): string {
    const kwLine = keywords.length > 0 ? `\nTarget keywords: ${keywords.join(', ')}` : '';
    return `Business description: "${description}"${kwLine}

Generate a complete website content plan as JSON matching this exact structure:
{
  "tagline": "Short punchy tagline, max 8 words",
  "tone": "One of: professional, friendly, premium, urgent",
  "theme": "One of: craftsman | industrial | luxury-green | security | agency | parchment | editorial | ivory",
  "font": "One of: inter | playfair | lora | montserrat | cormorant",
  "hero": {
    "headline": "Main H1 heading, max 10 words, include location if mentioned",
    "subheadline": "Supporting line, max 20 words",
    "cta": "Call-to-action button text, 2-4 words",
    "imagePrompt": "Vivid real-world scene for AI image generation — wide angle, no text, no screens, photorealistic"
  },
  "about": {
    "title": "About section heading, max 8 words",
    "body": "About paragraph, 50-80 words, first person, specific to the trade",
    "imagePrompt": "Vivid scene — tradesperson at work or professional portrait, natural light, no text"
  },
  "services": [
    {
      "title": "Specific service name, 2-5 words",
      "description": "What this service includes, 15-25 words",
      "imagePrompt": "Vivid real-world scene specific to this exact service — completed work, tools, or environment, no text, no screens"
    }
  ]
}

Write exactly 6 service entries. Make EVERYTHING specific to this exact business — no generic filler. Image prompts must describe real physical scenes that clearly represent that service.`;
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
        _context: RouteContext,
    ): Promise<Response> {
        try {
            const body = await request.json() as { description?: string; keywords?: string[] };
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

            const prompt = buildPlanPrompt(description, keywords);

            const geminiResponse = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'gemini-2.5-flash-lite',
                        messages: [
                            { role: 'system', content: PLAN_SYSTEM_PROMPT },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.7,
                        max_tokens: 2048,
                    }),
                }
            );

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
                logger.warn('Invalid theme from plan, defaulting to craftsman', { theme: plan.theme });
                plan.theme = 'craftsman';
            }
            if (!FONTS.includes(plan.font as SiteFont)) {
                logger.warn('Invalid font from plan, defaulting to inter', { font: plan.font });
                plan.font = 'inter';
            }

            if (!Array.isArray(plan.services) || plan.services.length < 6) {
                logger.warn('Plan has fewer than 6 services', { count: plan.services?.length });
            }

            return successResponse({ plan });
        } catch (error) {
            logger.error('Error in generatePlan', { error });
            return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
    }
}
