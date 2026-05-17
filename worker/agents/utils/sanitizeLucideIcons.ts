import validIconList from './validLucideIcons.json';
import type { FileOutputType } from '../schemas';
import { createLogger } from '../../logger';

const logger = createLogger('sanitizeLucideIcons');

// LLMs (especially on food/restaurant/niche prompts) invent Lucide names that
// don't exist — e.g. "burger", "frying-pan", "potato", "oven". These render as
// empty space and spam the browser console. We post-process HTML output to
// swap unknowns for a safe fallback so the site never ships missing icons.

const VALID_LUCIDE_ICONS = new Set<string>(validIconList);
const FALLBACK_ICON = 'circle-dot';

const DATA_LUCIDE_RE = /\bdata-lucide\s*=\s*"([^"]+)"/g;

export function sanitizeLucideIconsInHtml(html: string): { code: string; changed: boolean; replaced: string[] } {
	const replaced: string[] = [];
	const code = html.replace(DATA_LUCIDE_RE, (full, name: string) => {
		const trimmed = name.trim();
		if (VALID_LUCIDE_ICONS.has(trimmed)) return full;
		replaced.push(trimmed);
		return `data-lucide="${FALLBACK_ICON}"`;
	});
	return { code, changed: replaced.length > 0, replaced };
}

export function sanitizeLucideIconsInFiles(files: FileOutputType[]): FileOutputType[] {
	return files.map((f) => {
		if (!f.filePath.endsWith('.html')) return f;
		const result = sanitizeLucideIconsInHtml(f.fileContents);
		if (!result.changed) return f;
		logger.info('Replaced hallucinated Lucide icons', {
			filePath: f.filePath,
			replaced: result.replaced,
			fallback: FALLBACK_ICON,
		});
		return { ...f, fileContents: result.code };
	});
}
