import { useMemo } from 'react';
import { ImageIcon } from 'lucide-react';
import type { FileType } from '@/api-types';

interface SocialPreviewPanelProps {
	seoFile?: FileType;
	htmlFile?: FileType;
	faviconFile?: FileType;
	onSendMessage?: (msg: string) => void;
}

function extractOgImageUrl(html: string): string | null {
	const match =
		html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
		html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
	const url = match?.[1] ?? null;
	// Ignore unfilled template tokens
	if (!url || url.includes('{{') || url === 'undefined') return null;
	return url;
}

function extractOgTitle(html: string): string | null {
	const match =
		html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
		html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
	return match?.[1] ?? null;
}

function extractOgDescription(html: string): string | null {
	const match =
		html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ??
		html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
	return match?.[1] ?? null;
}

interface SeoFirstPage {
	title: string;
	description: string;
	canonicalUrl: string;
}

function parseSeoFirstPage(contents: string): SeoFirstPage | null {
	try {
		const data = JSON.parse(contents) as { pages?: SeoFirstPage[] };
		return data.pages?.[0] ?? null;
	} catch {
		return null;
	}
}

function FaviconPreview({ svgContent, pageTitle }: { svgContent: string; pageTitle: string }) {
	const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
	return (
		<div>
			<p className="text-xs text-text-primary/30 uppercase tracking-wider mb-3">Favicon</p>
			<div className="flex items-end gap-6 flex-wrap">
				{/* Browser tab mockup */}
				<div className="flex flex-col gap-1">
					<div className="flex items-end">
						{/* Active tab shape */}
						<div
							className="flex items-center gap-1.5 bg-bg-2 border border-b-0 border-text-primary/15 px-3 py-1.5 rounded-t-md max-w-[180px]"
							style={{ boxShadow: '0 -1px 0 0 rgba(255,255,255,0.06) inset' }}
						>
							<img src={dataUrl} alt="favicon" className="size-4 flex-shrink-0" />
							<span className="text-xs text-text-primary/70 truncate">{pageTitle || 'Your website'}</span>
							<span className="text-text-primary/25 text-xs ml-auto pl-1">×</span>
						</div>
					</div>
					<div className="h-px bg-text-primary/10" />
					<p className="text-[10px] text-text-primary/25 mt-0.5">Browser tab</p>
				</div>

				{/* Sizes */}
				<div className="flex items-end gap-5">
					<div className="flex flex-col items-center gap-1.5">
						<img src={dataUrl} alt="16px" className="size-4" />
						<span className="text-[10px] text-text-primary/25">16px</span>
					</div>
					<div className="flex flex-col items-center gap-1.5">
						<img src={dataUrl} alt="32px" className="size-8" />
						<span className="text-[10px] text-text-primary/25">32px</span>
					</div>
					<div className="flex flex-col items-center gap-1.5">
						<img src={dataUrl} alt="64px" className="size-16" />
						<span className="text-[10px] text-text-primary/25">64px</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function FaviconPlaceholder() {
	return (
		<div>
			<p className="text-xs text-text-primary/30 uppercase tracking-wider mb-3">Favicon</p>
			<div className="flex items-center gap-3 px-4 py-3 rounded-md bg-bg-3 border border-text-primary/8 border-dashed">
				<div className="size-8 rounded bg-text-primary/8 flex items-center justify-center text-text-primary/20 text-lg font-bold flex-shrink-0">?</div>
				<p className="text-xs text-text-primary/30">No favicon generated yet. Ask Orange to add one, or use the SEO panel to fix it.</p>
			</div>
		</div>
	);
}

function SocialCardPreview({
	ogImageUrl,
	title,
	description,
	canonicalUrl,
}: {
	ogImageUrl: string | null;
	title: string;
	description: string;
	canonicalUrl: string;
}) {
	let domain = 'yoursite.com';
	try {
		if (canonicalUrl) domain = new URL(canonicalUrl).hostname;
	} catch {}

	return (
		<div>
			<p className="text-xs text-text-primary/30 uppercase tracking-wider mb-3">Social sharing card</p>
			<p className="text-[11px] text-text-primary/25 mb-3">Appears on iMessage, WhatsApp, Twitter/X, Slack, LinkedIn</p>

			<div className="rounded-xl overflow-hidden border border-text-primary/10 bg-white/5 max-w-[320px]">
				{/* OG image */}
				<div className="aspect-[1.91/1] bg-bg-3 flex items-center justify-center overflow-hidden">
					{ogImageUrl ? (
						<img
							src={ogImageUrl}
							alt="OG preview"
							className="w-full h-full object-cover"
							onError={e => {
								(e.target as HTMLImageElement).style.display = 'none';
								(e.target as HTMLImageElement).parentElement!.classList.add('flex', 'flex-col', 'gap-2', 'items-center', 'justify-center');
							}}
						/>
					) : (
						<div className="flex flex-col items-center gap-2 text-text-primary/20">
							<ImageIcon className="size-8" />
							<span className="text-xs">No OG image set</span>
						</div>
					)}
				</div>

				{/* Card text */}
				<div className="px-3 py-2.5 border-t border-text-primary/10">
					<p className="text-[10px] text-text-primary/35 uppercase tracking-wide mb-0.5">{domain}</p>
					<p className="text-xs font-semibold text-text-primary/80 leading-snug line-clamp-1">
						{title || 'Page title'}
					</p>
					{description && (
						<p className="text-[11px] text-text-primary/40 leading-snug line-clamp-2 mt-0.5">
							{description}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

export function SocialPreviewPanel({ seoFile, htmlFile, faviconFile, onSendMessage }: SocialPreviewPanelProps) {
	const seoPage = useMemo(() => {
		if (!seoFile?.fileContents) return null;
		return parseSeoFirstPage(seoFile.fileContents);
	}, [seoFile]);

	const ogImageUrl = useMemo(() => {
		if (!htmlFile?.fileContents) return null;
		return extractOgImageUrl(htmlFile.fileContents);
	}, [htmlFile]);

	const ogTitle = useMemo(() => {
		if (!htmlFile?.fileContents) return null;
		return extractOgTitle(htmlFile.fileContents);
	}, [htmlFile]);

	const ogDescription = useMemo(() => {
		if (!htmlFile?.fileContents) return null;
		return extractOgDescription(htmlFile.fileContents);
	}, [htmlFile]);

	const faviconSvgContent = useMemo(() => {
		const content = faviconFile?.fileContents;
		if (!content) return null;
		if (content.includes('<svg') || content.includes('<SVG')) return content;
		return null;
	}, [faviconFile]);

	const title = ogTitle ?? seoPage?.title ?? '';
	const description = ogDescription ?? seoPage?.description ?? '';
	const canonicalUrl = seoPage?.canonicalUrl ?? '';

	if (!seoFile) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
				<div className="space-y-1">
					<p className="text-text-primary/50 text-sm font-medium">No social preview data yet</p>
					<p className="text-text-primary/30 text-xs max-w-xs">
						Generate SEO data first — it includes the OG tags and favicon needed for social sharing cards.
					</p>
				</div>
				{onSendMessage && (
					<button
						onClick={() => onSendMessage(
`[DIRECT FILE EDIT — use read_files then regenerate_file, do NOT use queue_request]
Add social sharing support to this website now — create the files directly:

1. Add Open Graph meta tags to index.html head:
   - <meta property="og:title" content="...">
   - <meta property="og:description" content="...">
   - <meta property="og:image" content="[hero image URL from the site]">
   - <meta property="og:image:width" content="1200">
   - <meta property="og:image:height" content="630">
   - <meta property="og:url" content="[canonical URL]">
   - <meta property="og:type" content="website">
   - <meta property="og:site_name" content="[business name]">

2. Create a seo.json file in the project root with pages array containing path, label, title, description, keywords (primary/longTail/secondary), h1, h2s, imageAlts, canonicalUrl, hasOgTags: true, hasOgImage: true, hasStructuredData, hasFavicon.

3. If no favicon exists, create /favicon.svg (square, brand colour background, first letter of business name in white) and add <link rel="icon" href="/favicon.svg"> to the HTML head.

Do this now — write the files.`
						)}
						className="px-4 py-2 rounded-md bg-accent text-black text-sm font-medium hover:bg-accent/90 transition-colors"
					>
						Generate SEO &amp; social data
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-3 sm:px-5 py-6 max-w-2xl mx-auto w-full flex flex-col gap-8">
				<div>
					<h2 className="text-sm font-medium text-text-primary/70 mb-1">Social sharing preview</h2>
					<p className="text-xs text-text-primary/30">How your site appears when someone shares the link.</p>
				</div>

				{faviconSvgContent ? (
					<FaviconPreview svgContent={faviconSvgContent} pageTitle={title} />
				) : (
					<FaviconPlaceholder />
				)}

				<SocialCardPreview
					ogImageUrl={ogImageUrl}
					title={title}
					description={description}
					canonicalUrl={canonicalUrl}
				/>
			</div>
		</div>
	);
}
