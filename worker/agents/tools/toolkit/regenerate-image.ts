import { tool, t } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';

export function createRegenerateImageTool(agent: ICodingAgent, logger: StructuredLogger) {
    return tool({
        name: 'regenerate_image',
        description: `Generates or regenerates an AI image for any section of the site.

Use a short, descriptive kebab-case slot name that matches the section: hero, work1, work2, project1–project6, about, services, etc.

- If the slot already exists, the image is replaced in-place.
- If the slot is new, the returned URL must be added to the relevant HTML section via regenerate_file.

Dimensions: hero slots use 1024×576. All other slots use 768×512.

**Quality tiers:**
- standard (default): Flux-1-schnell, fast, included in the site build cost (~$0.01/image)
- premium: Stable Diffusion XL, 20 inference steps, significantly more photorealistic (~$0.05–0.10/image)

Use standard for quick iterations. Offer premium when the user asks for more realistic or higher quality photos.

The description is combined with the original business context. Be specific: subject, setting, lighting, mood, colours.`,
        args: {
            slot: t.string().describe('Kebab-case slot name, e.g. hero, project1, about'),
            description: t.string().describe('Detailed description of what the image should show'),
            quality: t.string().optional().describe('Image quality tier: "standard" (default, Flux-1-schnell, fast, ~$0.01/image) or "premium" (SDXL, 20 steps, photorealistic, ~$0.05–0.10/image).'),
        },
        run: async ({ slot, description, quality }: { slot: string; description: string; quality?: string }) => {
            try {
                const tier: 'standard' | 'premium' = quality === 'premium' ? 'premium' : 'standard';
                logger.info('Generating image', { slot, description, tier });
                const { url } = await agent.regenerateImage(slot, description, tier);
                const note = tier === 'premium' ? ' (premium quality — SDXL)' : '';
                return `Image generated${note}. Slot: ${slot}\nURL: ${url}\n\nThe preview has refreshed. If this is a new slot, add <img src="${url}" ...> to the relevant HTML section using regenerate_file.`;
            } catch (error) {
                logger.error('Image generation failed', { error, slot });
                return `Failed to generate image: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        },
    });
}
