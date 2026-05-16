import { getPublicUrlForR2Image } from 'worker/utils/images';
import { createLogger } from 'worker/logger';

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
        promptSuffix: 'outdoors on an active job site, wide angle, natural daylight, DSLR photography, photorealistic',
        width: 1280,
        height: 640,
    },
    {
        key: 'work1',
        promptSuffix: 'skilled worker carrying out hands-on trade work close up, natural daylight, shallow depth of field, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'work2',
        promptSuffix: 'high-quality finished trade work result, wide shot, natural light, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project1',
        promptSuffix: 'completed outdoor project, golden hour lighting, wide angle, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project2',
        promptSuffix: 'close-up detail of expert craftsmanship and quality finish, macro lens, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project3',
        promptSuffix: 'tradesperson actively working on location mid-task, natural daylight, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project4',
        promptSuffix: 'finished indoor work result, clean professional finish, bright natural light, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project5',
        promptSuffix: 'professional tools and equipment arranged on a job site, overhead shot, DSLR photography',
        width: 768,
        height: 512,
    },
    {
        key: 'project6',
        promptSuffix: 'dramatic before-and-after completed transformation, wide angle, bright natural light, DSLR photography',
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

async function runFlux(env: Env, prompt: string, width: number, height: number): Promise<Uint8Array> {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt,
        num_steps: 4,
        width,
        height,
    });

    if (!response.image) {
        throw new Error('Flux returned no image data');
    }

    return base64ToBytes(response.image);
}

async function runPremiumModel(env: Env, prompt: string): Promise<Uint8Array> {
    // SDXL produces significantly more detailed and photorealistic results at higher compute cost
    const response = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
        prompt,
        num_steps: 20,
    }) as unknown as ReadableStream<Uint8Array>;

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

export async function generateTradeImages(
    env: Env,
    agentId: string,
    query: string,
): Promise<GeneratedTradeImages | null> {
    logger.info('Generating trade images', { agentId, queryLength: query.length });
    const businessContext = extractBusinessContext(query);

    try {
        const results = await Promise.all(
            IMAGE_SPECS.map(async ({ key, promptSuffix, width, height }) => {
                const prompt = `${PHOTO_PREFIX} ${businessContext}, ${promptSuffix}`;
                const bytes = await runFlux(env, prompt, width, height);
                const r2Key = `generated-images/${agentId}/${key}.png`;

                await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
                    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
                    customMetadata: { agentId },
                });

                const url = `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
                logger.info(`Generated image: ${key}`, { url });
                return [key, url] as const;
            })
        );

        return Object.fromEntries(results) as unknown as GeneratedTradeImages;
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
        ? await runPremiumModel(env, safePrompt)
        : await runFlux(env, safePrompt, width, height);
    const r2Key = `generated-images/${agentId}/${slot}.png`;

    await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { agentId },
    });

    return `${getPublicUrlForR2Image(env, r2Key)}?v=${Date.now()}`;
}

export function buildImageContext(images: GeneratedTradeImages): string {
    return `

[GENERATED IMAGES]
CRITICAL: Exactly 9 real images have been generated for this site. These are the ONLY images you may use. Do NOT use placeholder images, stock photos, or URLs from unsplash.com, picsum.photos, placehold.it, or any other external image source.

Token mapping — use exactly these URLs for the corresponding tokens:
- {{HERO_IMAGE_URL}} → ${images.hero}
- {{ABOUT_IMAGE_URL}} → ${images.work1}
- {{PROJECT1_IMAGE_URL}} → ${images.project1}
- {{PROJECT2_IMAGE_URL}} → ${images.project2}
- {{PROJECT3_IMAGE_URL}} → ${images.project3}
- {{PROJECT4_IMAGE_URL}} → ${images.project4}
- {{PROJECT5_IMAGE_URL}} → ${images.project5}
- {{PROJECT6_IMAGE_URL}} → ${images.project6}

Rules:
- Copy every URL character-for-character including any ?v= query string
- Do NOT use any other image URLs anywhere in the HTML
- Do NOT write invented paths like images/photo.jpg or any unsplash/placehold URL
[END GENERATED IMAGES]
`;
}
