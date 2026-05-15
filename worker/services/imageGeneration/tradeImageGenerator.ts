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

const NO_TEXT = 'no text, no words, no writing, no watermarks, no logos, no signs, no captions, no overlays, no website, no screenshot, no mockup, no UI, no computer screen, no browser, no interface';
const PHOTO_PREFIX = 'A real-world professional photograph of';

const IMAGE_SPECS: Array<{
    key: keyof GeneratedTradeImages;
    promptSuffix: string;
    width: number;
    height: number;
}> = [
    {
        key: 'hero',
        promptSuffix: `wide angle exterior or action shot, cinematic natural lighting, DSLR photography, sharp focus, commercial photography style, photorealistic, ${NO_TEXT}`,
        width: 1024,
        height: 576,
    },
    {
        key: 'work1',
        promptSuffix: `skilled tradesperson at work on a job, close detail shot, natural daylight, DSLR photography, shallow depth of field, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'work2',
        promptSuffix: `beautifully finished professional work result, wide shot, natural lighting, DSLR photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project1',
        promptSuffix: `completed project, exterior view, golden hour lighting, DSLR photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project2',
        promptSuffix: `close-up detail of expert craftsmanship and quality finish, macro photography, DSLR, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project3',
        promptSuffix: `tradesperson actively working on a project, mid-action, natural daylight, DSLR photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project4',
        promptSuffix: `finished job, interior or close view, clean professional result, DSLR photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project5',
        promptSuffix: `professional tools and equipment laid out neatly on a job site, overhead shot, DSLR photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'project6',
        promptSuffix: `before-and-after style completed transformation, wide angle, bright natural light, DSLR photography, photorealistic, ${NO_TEXT}`,
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

function extractBusinessContext(query: string): string {
    return query
        .replace(/^(please\s+)?(build|create|make|design|generate|develop)\s+(me\s+)?(a\s+)?(website|site|web\s*page|landing\s*page)\s+(for\s+(a\s+)?)?/i, '')
        .replace(/\[GENERATED IMAGES\][\s\S]*?\[END GENERATED IMAGES\]/g, '')
        .trim();
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
                    httpMetadata: { contentType: 'image/png' },
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
): Promise<string> {
    if (!agentId || agentId === 'undefined') throw new Error('Agent ID is not set — cannot generate image');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slot)) throw new Error(`Invalid image slot name: ${slot}`);

    const spec = IMAGE_SPECS.find(s => s.key === slot);
    const width = spec?.width ?? DEFAULT_WIDTH;
    const height = spec?.height ?? DEFAULT_HEIGHT;

    const basePrompt = prompt.startsWith(PHOTO_PREFIX) ? prompt : `${PHOTO_PREFIX} ${prompt}`;
    const safePrompt = basePrompt.includes('no website') ? basePrompt : `${basePrompt}, ${NO_TEXT}`;
    const bytes = await runFlux(env, safePrompt, width, height);
    const r2Key = `generated-images/${agentId}/${slot}.png`;

    await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: 'image/png' },
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
