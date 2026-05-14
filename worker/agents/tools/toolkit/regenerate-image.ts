import { tool, t } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';

export function createRegenerateImageTool(agent: ICodingAgent, logger: StructuredLogger) {
    return tool({
        name: 'regenerate_image',
        description: `Generates or regenerates an AI image for any section of the site.

Use a short, descriptive kebab-case slot name that matches the section: hero, carousel-1, carousel-2, gallery-1, testimonials, about, services, etc.

- If the slot already exists, the image is replaced in-place — the URL stays the same so the HTML needs no changes.
- If the slot is new, the returned URL must be added to the relevant HTML section via regenerate_file.

Dimensions: hero slots use 1024×576 (landscape banner). All other slots use 768×512.

The description is combined with the original business context to build the image prompt. Be specific: subject, setting, lighting, mood, colours.

After generation the preview auto-refreshes.`,
        args: {
            slot: t.string().describe('Kebab-case slot name matching the section, e.g. hero, carousel-1, gallery-2, testimonials'),
            description: t.string().describe('Detailed description of what the image should show'),
        },
        run: async ({ slot, description }: { slot: string; description: string }) => {
            try {
                logger.info('Generating image', { slot, description });
                const { url } = await agent.regenerateImage(slot, description);
                return `Image generated. Slot: ${slot}\nURL: ${url}\n\nThe preview has refreshed. If this is a new slot, add <img src="${url}" ...> to the relevant HTML section using regenerate_file.`;
            } catch (error) {
                logger.error('Image generation failed', { error, slot });
                return `Failed to generate image: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        },
    });
}
