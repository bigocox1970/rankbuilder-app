import { getPublicUrlForR2Image } from 'worker/utils/images';
import { createLogger } from 'worker/logger';
import type { SiteContentPlan } from 'worker/api/controllers/agent/types';

const logger = createLogger('TradeImageGenerator');

export interface GeneratedTradeImages {
    hero: string;
    work1: string;
    work2: string;
    project1: string;
    project2: string;
    project3: string;
    project4: string;
    project5: string;
    project6: string;
    projectTitles: string[];
}

// Keep NO_TEXT minimal — mentioning "website/screenshot/UI" (even negated) causes
// Flux Schnell to focus on those concepts and generate them.
const NO_TEXT = 'no text, no letters, no watermarks';
const PHOTO_PREFIX = 'Real-world photograph of';

const IMAGE_SPECS: Array<{
    key: keyof GeneratedTradeImages;
    promptSuffix: string;
    width: number;
    height: number;
}> = [
    {
        key: 'hero',
        promptSuffix: 'wide angle establishing shot, professional environment, natural daylight, DSLR photography, photorealistic',
        width: 1280,
        height: 640,
    },
    {
        key: 'work1',
        promptSuffix: 'professional at work, close up, natural daylight, shallow depth of field, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'work2',
        promptSuffix: 'high-quality finished result, wide shot, natural light, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project1',
        promptSuffix: 'completed professional project, warm golden hour lighting, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project2',
        promptSuffix: 'close-up detail of expert quality and craftsmanship, macro lens, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project3',
        promptSuffix: 'professional actively working on location, natural daylight, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project4',
        promptSuffix: 'impressive finished result in a clean professional setting, bright natural light, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project5',
        promptSuffix: 'professional workspace with equipment and tools of the trade, overhead shot, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project6',
        promptSuffix: 'completed transformation showing outstanding final result, wide angle, bright natural light, DSLR photography',
        width: 768,
        height: 512,
    },
];

// Flux returns base64-encoded PNG in response.image
function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function gatewayOpts(env: Env, agentId: string, actionKey: string) {
    return {
        gateway: {
            id: env.CLOUDFLARE_AI_GATEWAY,
            metadata: { chatId: agentId, actionKey },
        },
    } as const;
}

async function runFlux(env: Env, agentId: string, prompt: string, width: number, height: number): Promise<Uint8Array> {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt,
        num_steps: 4,
        width,
        height,
    }, gatewayOpts(env, agentId, 'imageGeneration.flux'));

    if (!response.image) {
        throw new Error('Flux returned no image data');
    }

    return base64ToBytes(response.image);
}

async function runPremiumModel(env: Env, agentId: string, prompt: string): Promise<Uint8Array> {
    // SDXL produces significantly more detailed and photorealistic results at higher compute cost
    const response = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
        prompt,
        num_steps: 20,
    }, gatewayOpts(env, agentId, 'imageGeneration.sdxl')) as unknown as ReadableStream<Uint8Array>;

    const resp = new Response(response);
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
}

function extractBusinessContext(query: string): string {
    let context = query
        .replace(/^(please\s+)?(build|create|make|design|generate|develop)\s+(me\s+)?(a\s+)?(website|site|web\s*page|landing\s*page|page)\s+(for\s+(a\s+|the\s+)?)?/i, '')
        .replace(/\[GENERATED IMAGES\][\s\S]*?\[END GENERATED IMAGES\]/g, '')
        .trim();

    // Take only the first sentence — everything after is typically website
    // design instructions, not business description, and will corrupt image prompts.
    const firstSentence = context.split(/[.!?\n]/)[0].trim();
    context = firstSentence || context;

    // Strip web/design vocabulary that would make Flux generate screenshots
    context = context
        .replace(/\b(website|web\s*site|web\s*page|landing\s*page|site|homepage|hero(\s*section)?|nav(igation)?|footer|header|section|dark\s*theme|light\s*theme|layout|design|theme|style)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return context || 'a skilled tradesperson';
}

const PROJECT_KEYS = ['project1', 'project2', 'project3', 'project4', 'project5', 'project6'] as const;

async function generateProjectTitles(env: Env, agentId: string, businessContext: string): Promise<string[]> {
    try {
        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof env.AI.run>[0], {
            prompt: `You are helping build a business website. List exactly 6 specific services or project examples for a "${businessContext}" business. Return ONLY a valid JSON array of 6 short titles (3–6 words each). No explanation, no markdown, no extra text — just the JSON array.

Example for "gardener": ["Turfing and Lawn Edging","Tree Surgery and Pruning","Shrub Planting and Design","Patio and Pathway Laying","Hedge Trimming and Shaping","Garden Clearance and Tidying"]

For "${businessContext}":`,
            max_tokens: 200,
        }, gatewayOpts(env, agentId, 'imageGeneration.titles')) as { response: string };

        const text = (response as { response: string }).response ?? '';
        const match = text.match(/\[[\s\S]*?\]/);
        if (!match) throw new Error('no JSON array in response');
        const titles: unknown = JSON.parse(match[0]);
        if (!Array.isArray(titles) || titles.length < 6) throw new Error('unexpected array length');
        return (titles as unknown[]).slice(0, 6).map(t => String(t));
    } catch (err) {
        logger.warn('Project title generation failed, using generic titles', { err });
        return PROJECT_KEYS.map((_, i) => `Project ${i + 1}`);
    }
}

export async function generateTradeImages(
    env: Env,
    agentId: string,
    query: string,
): Promise<GeneratedTradeImages | null> {
    logger.info('Generating trade images', { agentId, queryLength: query.length });
    const businessContext = extractBusinessContext(query);

    try {
        // Generate project card titles first, then use them as image prompts so
        // images match the content the AI will write for each card.
        const projectTitles = await generateProjectTitles(env, agentId, businessContext);
        logger.info('Project titles for image generation', { projectTitles });

        const nonProjectSpecs = IMAGE_SPECS.filter(s => !PROJECT_KEYS.includes(s.key as typeof PROJECT_KEYS[number]));
        const projectSpecs = PROJECT_KEYS.map((key, i) => ({
            key: key as keyof GeneratedTradeImages,
            prompt: `${PHOTO_PREFIX} ${businessContext}, ${projectTitles[i]}, DSLR photography, photorealistic, ${NO_TEXT}`,
            width: 768,
            height: 512,
        }));

        const results = await Promise.all([
            // Hero and about images use generic business-context prompts
            ...nonProjectSpecs.map(async ({ key, promptSuffix, width, height }) => {
                const prompt = `${PHOTO_PREFIX} ${businessContext}, ${promptSuffix}, ${NO_TEXT}`;
                const bytes = await runFlux(env, agentId, prompt, width, height);
                const r2Key = `generated-images/${agentId}/${key}.png`;
                await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
                    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
                    customMetadata: { agentId },
                });
                const url = `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
                logger.info(`Generated image: ${key}`, { url });
                return [key, url] as const;
            }),
            // Project images generated from the specific card titles
            ...projectSpecs.map(async ({ key, prompt, width, height }) => {
                const bytes = await runFlux(env, agentId, prompt, width, height);
                const r2Key = `generated-images/${agentId}/${key}.png`;
                await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
                    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
                    customMetadata: { agentId },
                });
                const url = `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
                logger.info(`Generated image: ${key}`, { url });
                return [key, url] as const;
            }),
        ]);

        return {
            ...(Object.fromEntries(results) as Omit<GeneratedTradeImages, 'projectTitles'>),
            projectTitles,
        };
    } catch (error) {
        logger.error('Image generation failed, continuing without images', { error });
        return null;
    }
}

// Default dimensions for any slot not in IMAGE_SPECS
const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 512;

export async function regenerateTradeImage(
    env: Env,
    agentId: string,
    slot: string,
    prompt: string,
    quality: 'standard' | 'premium' = 'standard',
): Promise<string> {
    if (!agentId || agentId === 'undefined') throw new Error('Agent ID is not set — cannot generate image');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slot)) throw new Error(`Invalid image slot name: ${slot}`);

    const spec = IMAGE_SPECS.find(s => s.key === slot);
    const width = spec?.width ?? DEFAULT_WIDTH;
    const height = spec?.height ?? DEFAULT_HEIGHT;

    const basePrompt = prompt.startsWith(PHOTO_PREFIX) ? prompt : `${PHOTO_PREFIX} ${prompt}`;
    const safePrompt = basePrompt.includes('no watermarks') ? basePrompt : `${basePrompt}, ${NO_TEXT}`;
    const bytes = quality === 'premium'
        ? await runPremiumModel(env, agentId, safePrompt)
        : await runFlux(env, agentId, safePrompt, width, height);
    const r2Key = `generated-images/${agentId}/${slot}.png`;

    await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { agentId },
    });

    return `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
}

export interface ImageProgressEvent {
    slot: string;
    label: string;
    index: number;
    total: number;
}

/**
 * Generate images sequentially using pre-planned prompts from the site plan.
 * Emits progress events so the UI can show per-image status.
 */
export async function generateTradeImagesFromPlan(
    env: Env,
    agentId: string,
    plan: SiteContentPlan,
    onProgress: (event: ImageProgressEvent) => void,
): Promise<GeneratedTradeImages | null> {
    logger.info('Generating trade images from plan', { agentId });

    const slots: Array<{ key: keyof GeneratedTradeImages; label: string; prompt: string; width: number; height: number }> = [
        { key: 'hero',     label: plan.hero.headline || 'Hero',         prompt: plan.hero.imagePrompt,     width: 1280, height: 640 },
        { key: 'work1',    label: plan.about.title || 'About',          prompt: plan.about.imagePrompt,    width: 768,  height: 512 },
        { key: 'work2',    label: 'Team & Equipment',                    prompt: `${PHOTO_PREFIX} ${plan.hero.imagePrompt}, wide shot, professional environment, DSLR photography`, width: 768, height: 512 },
        ...plan.services.slice(0, 6).map((svc, i) => ({
            key: `project${i + 1}` as keyof GeneratedTradeImages,
            label: svc.title,
            // Anchor each card image to its actual subject (the card title) so a
            // "Bench Press" / "French Pastries" card gets THAT specific image, not a
            // generic gym/shop shot. The title leads the prompt so Flux focuses on it.
            prompt: `${PHOTO_PREFIX} ${svc.title}. ${svc.imagePrompt}`,
            width: 768,
            height: 512,
        })),
    ];

    const total = slots.length;
    const results: Array<readonly [keyof GeneratedTradeImages, string]> = [];
    const projectTitles: string[] = plan.services.slice(0, 6).map(s => s.title);

    try {
        for (let i = 0; i < slots.length; i++) {
            const { key, label, prompt, width, height } = slots[i];
            onProgress({ slot: key as string, label, index: i + 1, total });

            const safePrompt = prompt.startsWith(PHOTO_PREFIX) ? prompt : `${PHOTO_PREFIX} ${prompt}`;
            const finalPrompt = safePrompt.includes('no watermarks') ? safePrompt : `${safePrompt}, ${NO_TEXT}`;

            const bytes = await runFlux(env, agentId, finalPrompt, width, height);
            const r2Key = `generated-images/${agentId}/${key}.png`;
            await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
                httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
                customMetadata: { agentId },
            });
            const url = `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
            logger.info(`Generated image from plan: ${key}`, { url });
            results.push([key, url] as const);
        }

        return {
            ...(Object.fromEntries(results) as Omit<GeneratedTradeImages, 'projectTitles'>),
            projectTitles,
        };
    } catch (error) {
        logger.error('Plan-based image generation failed, continuing without images', { error });
        return null;
    }
}

export function buildImageContext(images: GeneratedTradeImages): string {
    const titles = images.projectTitles ?? PROJECT_KEYS.map((_, i) => `Project ${i + 1}`);

    return `

[GENERATED IMAGES]
CRITICAL: Exactly 9 real images have been generated for this site. These are the ONLY images you may use. Do NOT use placeholder images, stock photos, or URLs from unsplash.com, picsum.photos, placehold.it, or any other external image source.

Token mapping — use exactly these URLs and titles:
- {{HERO_IMAGE_URL}} → ${images.hero}
- {{ABOUT_IMAGE_URL}} → ${images.work1}
- {{PROJECT1_IMAGE_URL}} → ${images.project1}
  USE THIS EXACT TITLE for {{PROJECT1_TITLE}}: "${titles[0]}"
- {{PROJECT2_IMAGE_URL}} → ${images.project2}
  USE THIS EXACT TITLE for {{PROJECT2_TITLE}}: "${titles[1]}"
- {{PROJECT3_IMAGE_URL}} → ${images.project3}
  USE THIS EXACT TITLE for {{PROJECT3_TITLE}}: "${titles[2]}"
- {{PROJECT4_IMAGE_URL}} → ${images.project4}
  USE THIS EXACT TITLE for {{PROJECT4_TITLE}}: "${titles[3]}"
- {{PROJECT5_IMAGE_URL}} → ${images.project5}
  USE THIS EXACT TITLE for {{PROJECT5_TITLE}}: "${titles[4]}"
- {{PROJECT6_IMAGE_URL}} → ${images.project6}
  USE THIS EXACT TITLE for {{PROJECT6_TITLE}}: "${titles[5]}"

The project images were generated specifically to match these titles. You MUST use the exact titles above for the project cards — the images will not make sense with different titles.

Rules:
- Copy every URL character-for-character including any ?v= query string
- Do NOT use any other image URLs anywhere in the HTML
- Do NOT write invented paths like images/photo.jpg or any unsplash/placehold URL
[END GENERATED IMAGES]
`;
}
