import { getPublicUrlForR2Image } from 'worker/utils/images';
import { createLogger } from 'worker/logger';

const logger = createLogger('TradeImageGenerator');

export interface GeneratedTradeImages {
    hero: string;
    work1: string;
    work2: string;
}

const NO_TEXT = 'no text, no words, no writing, no watermarks, no logos, no signs, no captions, no overlays';

const IMAGE_SPECS: Array<{
    key: keyof GeneratedTradeImages;
    promptSuffix: string;
    width: number;
    height: number;
}> = [
    {
        key: 'hero',
        promptSuffix: `professional hero shot, wide angle landscape, cinematic lighting, commercial photography, high quality, photorealistic, ${NO_TEXT}`,
        width: 1024,
        height: 576,
    },
    {
        key: 'work1',
        promptSuffix: `skilled professional at work, close detail shot, natural lighting, high quality photography, photorealistic, ${NO_TEXT}`,
        width: 768,
        height: 512,
    },
    {
        key: 'work2',
        promptSuffix: `completed professional work, beautiful clean result, high quality photography, photorealistic, ${NO_TEXT}`,
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
                const prompt = `${businessContext}, ${promptSuffix}`;
                const bytes = await runFlux(env, prompt, width, height);
                const r2Key = `generated-images/${agentId}/${key}.png`;

                await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
                    httpMetadata: { contentType: 'image/png' },
                    customMetadata: { agentId },
                });

                const url = getPublicUrlForR2Image(env, r2Key);
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

    const safePrompt = prompt.includes('no text') ? prompt : `${prompt}, ${NO_TEXT}`;
    const bytes = await runFlux(env, safePrompt, width, height);
    const r2Key = `generated-images/${agentId}/${slot}.png`;

    await env.TEMPLATES_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { agentId },
    });

    return getPublicUrlForR2Image(env, r2Key);
}

export function buildImageContext(images: GeneratedTradeImages): string {
    return `

[GENERATED IMAGES]
CRITICAL: Exactly 3 real images have been generated for this site. These are the ONLY images you may use. Do NOT use placeholder images, stock photos, or URLs from unsplash.com, picsum.photos, placehold.it, or any other external image source.

Rules:
- Use ONLY the 3 URLs below — no other image URLs anywhere in the HTML
- Do NOT create gallery sections with more than 3 images
- Do NOT add <img> tags or CSS background-image references to any URL not listed here
- Design sections to use these images, not the other way around

Hero image (main hero/banner, full width): ${images.hero}
Work image 1 (services or portfolio section): ${images.work1}
Work image 2 (about section or secondary content): ${images.work2}
[END GENERATED IMAGES]
`;
}
