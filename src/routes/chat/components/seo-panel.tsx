import { useMemo, useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, Pencil, X, Check } from 'lucide-react';
import clsx from 'clsx';
import type { FileType } from '@/api-types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeoKeywords {
	primary: string;
	longTail: string;
	secondary: string[];
}

interface SeoPage {
	path: string;
	label: string;
	title: string;
	description: string;
	keywords: SeoKeywords | string[];
	h1: string;
	h2s: string[];
	imageAlts: string[];
	canonicalUrl: string;
	hasOgTags: boolean;
	hasOgImage?: boolean;
	hasStructuredData: boolean;
	hasFavicon?: boolean;
}

interface SeoData {
	pages: SeoPage[];
}

function normaliseKeywords(raw: SeoKeywords | string[] | null | undefined): SeoKeywords {
	if (!raw) return { primary: '', longTail: '', secondary: [] };
	if (Array.isArray(raw)) {
		return { primary: raw[0] ?? '', longTail: raw[1] ?? '', secondary: raw.slice(2) };
	}
	return { primary: raw.primary ?? '', longTail: raw.longTail ?? '', secondary: raw.secondary ?? [] };
}

function normalisePage(raw: Partial<SeoPage>): SeoPage {
	return {
		path: raw.path ?? '',
		label: raw.label ?? '',
		title: raw.title ?? '',
		description: raw.description ?? '',
		keywords: raw.keywords ?? { primary: '', longTail: '', secondary: [] },
		h1: raw.h1 ?? '',
		h2s: raw.h2s ?? [],
		imageAlts: raw.imageAlts ?? [],
		canonicalUrl: raw.canonicalUrl ?? '',
		hasOgTags: raw.hasOgTags ?? false,
		hasOgImage: raw.hasOgImage,
		hasStructuredData: raw.hasStructuredData ?? false,
		hasFavicon: raw.hasFavicon,
	};
}

function keywordsToMetaString(kw: SeoKeywords): string {
	return [kw.primary, kw.longTail, ...kw.secondary].filter(Boolean).join(', ');
}

// Exact phrase first, then all significant words present anywhere (handles "hairdresser in Abingdon" for "abingdon hairdresser")
function kwInText(keyword: string, text: string): boolean {
	if (!keyword || !text) return false;
	const kLower = keyword.toLowerCase();
	const tLower = text.toLowerCase();
	if (tLower.includes(kLower)) return true;
	const words = kLower.split(/\s+/).filter(w => w.length > 1);
	return words.length > 1 && words.every(w => tLower.includes(w));
}

// ─── HTML detection ───────────────────────────────────────────────────────────

interface HtmlSignals {
	hasOgImage: boolean;
	hasFavicon: boolean;
}

function detectFromHtml(html: string): HtmlSignals {
	const hasOgImage = /<meta[^>]+property=["']og:image["'][^>]*>/i.test(html)
		|| /<meta[^>]+og:image[^>]+content=["'][^"']+["']/i.test(html);
	const hasFavicon = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.test(html)
		|| /<link[^>]+href=["'][^"']*favicon[^"']*["'][^>]*>/i.test(html);
	return { hasOgImage, hasFavicon };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface ScoreCheck {
	label: string;
	passed: boolean;
	partial?: boolean;
	detail?: string;
	points: number;
	earned: number;
}

function scorePage(page: SeoPage, htmlSignals?: HtmlSignals): { checks: ScoreCheck[]; total: number; max: number } {
	const kw = normaliseKeywords(page.keywords);
	const checks: ScoreCheck[] = [];
	const primary = kw.primary.toLowerCase();
	const longTail = kw.longTail.toLowerCase();

	const titleLen = page.title.length;
	const descLen = page.description.length;

	if (primary) {
		const inTitle = kwInText(kw.primary, page.title);
		checks.push({ label: 'Primary keyword in title', passed: inTitle, points: 15, earned: inTitle ? 15 : 0, detail: inTitle ? undefined : `"${kw.primary}" missing` });
		const inH1 = kwInText(kw.primary, page.h1);
		checks.push({ label: 'Primary keyword in H1', passed: inH1, points: 15, earned: inH1 ? 15 : 0, detail: inH1 ? undefined : `"${kw.primary}" missing` });
	}

	if (longTail) {
		const passed = kwInText(kw.longTail, page.description);
		checks.push({ label: 'Long-tail keyword in description', passed, points: 12, earned: passed ? 12 : 0, detail: passed ? undefined : `"${kw.longTail}" missing` });
	} else if (primary) {
		const passed = kwInText(kw.primary, page.description);
		checks.push({ label: 'Primary keyword in description', passed, points: 12, earned: passed ? 12 : 0, detail: passed ? undefined : `"${kw.primary}" missing` });
	}

	const h2Text = page.h2s.join(' ');
	const altText = page.imageAlts.join(' ');

	if (primary) {
		const inH2 = kwInText(kw.primary, h2Text);
		checks.push({ label: 'Primary keyword in H2', passed: inH2, points: 8, earned: inH2 ? 8 : 0 });
	}

	if (primary || longTail) {
		const inAlt = (primary ? kwInText(kw.primary, altText) : false) || (longTail ? kwInText(kw.longTail, altText) : false);
		checks.push({ label: 'Keyword in image alt text', passed: inAlt, points: 8, earned: inAlt ? 8 : 0, detail: page.imageAlts.length === 0 ? 'no alts in seo.json' : undefined });
	}

	{
		const perfect = titleLen >= 50 && titleLen <= 60;
		const ok = titleLen >= 40 && titleLen <= 70;
		checks.push({ label: 'Title length (50–60 chars)', passed: perfect, partial: !perfect && ok, points: 10, earned: perfect ? 10 : ok ? 5 : 0, detail: `${titleLen} chars` });
	}

	{
		const perfect = descLen >= 140 && descLen <= 160;
		const ok = descLen >= 120 && descLen <= 170;
		checks.push({ label: 'Description length (140–160 chars)', passed: perfect, partial: !perfect && ok, points: 10, earned: perfect ? 10 : ok ? 5 : 0, detail: `${descLen} chars` });
	}

	checks.push({ label: 'H1 tag present', passed: page.h1.trim().length > 0, points: 5, earned: page.h1.trim().length > 0 ? 5 : 0 });
	checks.push({ label: 'At least 2 H2 tags', passed: page.h2s.length >= 2, points: 5, earned: page.h2s.length >= 2 ? 5 : 0, detail: `${page.h2s.length} found` });
	checks.push({ label: 'Canonical URL set', passed: page.canonicalUrl.trim().length > 0, points: 5, earned: page.canonicalUrl.trim().length > 0 ? 5 : 0 });
	checks.push({ label: 'Open Graph tags', passed: page.hasOgTags, points: 4, earned: page.hasOgTags ? 4 : 0 });
	{
		// Prefer live HTML detection over the seo.json flag which the agent sometimes sets optimistically
		const hasOgImage = htmlSignals ? htmlSignals.hasOgImage : !!page.hasOgImage;
		checks.push({ label: 'OG image (social sharing card)', passed: hasOgImage, points: 5, earned: hasOgImage ? 5 : 0 });
	}
	{
		const hasFavicon = htmlSignals ? htmlSignals.hasFavicon : !!page.hasFavicon;
		checks.push({ label: 'Favicon', passed: hasFavicon, points: 3, earned: hasFavicon ? 3 : 0 });
	}
	checks.push({ label: 'Structured data (JSON-LD)', passed: page.hasStructuredData, points: 3, earned: page.hasStructuredData ? 3 : 0 });

	const max = checks.reduce((s, c) => s + c.points, 0);
	const total = checks.reduce((s, c) => s + c.earned, 0);
	return { checks, total, max };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBadge({ score, max }: { score: number; max: number }) {
	const pct = Math.round((score / max) * 100);
	const color = pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-yellow-400' : pct >= 50 ? 'text-orange-400' : 'text-red-400';
	const bg = pct >= 90 ? 'bg-emerald-400/10' : pct >= 75 ? 'bg-yellow-400/10' : pct >= 50 ? 'bg-orange-400/10' : 'bg-red-400/10';
	const label = pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : pct >= 50 ? 'Needs work' : 'Poor';
	return (
		<div className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-full', bg)}>
			<span className={clsx('text-xl font-bold tabular-nums', color)}>{pct}%</span>
			<div className="flex flex-col">
				<span className={clsx('text-xs font-medium leading-none', color)}>{label}</span>
				<span className="text-text-primary/30 text-[10px] tabular-nums leading-none mt-0.5">{score}/{max} pts</span>
			</div>
		</div>
	);
}

function CheckRow({ check }: { check: ScoreCheck }) {
	const icon = check.passed
		? <CheckCircle2 className="size-4 text-emerald-400 flex-shrink-0" />
		: check.partial
			? <AlertCircle className="size-4 text-yellow-400 flex-shrink-0" />
			: <XCircle className="size-4 text-red-400/70 flex-shrink-0" />;
	return (
		<div className="flex items-center gap-2.5 py-1.5 border-b border-text-primary/5 last:border-0">
			{icon}
			<span className={clsx('text-xs flex-1', check.passed ? 'text-text-primary/80' : check.partial ? 'text-text-primary/60' : 'text-text-primary/40')}>
				{check.label}
			</span>
			{check.detail && <span className="text-xs text-text-primary/30 tabular-nums">{check.detail}</span>}
			<span className="text-xs tabular-nums text-text-primary/30 w-8 text-right">+{check.earned}</span>
		</div>
	);
}

type FieldState = 'green' | 'amber' | 'red' | 'neutral';

function fieldState(len: number, perfectMin: number, perfectMax: number, okMin: number, okMax: number): FieldState {
	if (len === 0) return 'neutral';
	if (len >= perfectMin && len <= perfectMax) return 'green';
	if (len >= okMin && len <= okMax) return 'amber';
	return 'red';
}

const STATE_BORDER: Record<FieldState, string> = {
	green: 'border-emerald-400/50',
	amber: 'border-yellow-400/50',
	red: 'border-red-400/40',
	neutral: 'border-text-primary/10',
};

function CharCounter({ value, min, max }: { value: string; min: number; max: number }) {
	const len = value.length;
	const color = len >= min && len <= max
		? 'text-emerald-400'
		: len >= min * 0.8 && len <= max * 1.2
			? 'text-yellow-400'
			: 'text-red-400/70';
	return <span className={clsx('text-xs tabular-nums', color)}>{len}/{max}</span>;
}

function SerpPreview({ title, description, url, state }: { title: string; description: string; url: string; state?: FieldState }) {
	return (
		<div className={clsx('rounded-lg bg-white/5 border p-4 text-left transition-colors', STATE_BORDER[state ?? 'neutral'])}>
			<p className="text-xs text-text-primary/30 mb-2 uppercase tracking-wider">Google preview</p>
			<div className="flex items-center gap-1.5 mb-0.5">
				<div className="size-4 rounded-full bg-text-primary/20" />
				<span className="text-xs text-text-primary/50 truncate">{url || 'https://yoursite.com'}</span>
			</div>
			<p className="text-[15px] text-blue-400 font-medium leading-snug truncate">
				{title || 'Page title will appear here'}
			</p>
			<p className="text-xs text-text-primary/60 mt-0.5 leading-relaxed line-clamp-2">
				{description || 'Meta description will appear here. Make it compelling, 140–160 characters (max 160).'}
			</p>
		</div>
	);
}

function KeywordCoverage({ keyword, page }: { keyword: string; page: SeoPage }) {
	const spots = [
		{ label: 'Title', hit: kwInText(keyword, page.title) },
		{ label: 'H1', hit: kwInText(keyword, page.h1) },
		{ label: 'Description', hit: kwInText(keyword, page.description) },
		{ label: 'H2s', hit: page.h2s.some(h => kwInText(keyword, h)) },
		{ label: 'Image alts', hit: page.imageAlts.some(a => kwInText(keyword, a)) },
	];
	return (
		<div className="mt-2 px-3 py-2.5 rounded-md bg-bg-3/60 border border-text-primary/8">
			<p className="text-xs text-text-primary/40 mb-2">
				Coverage for <span className="text-text-primary/70 font-medium">"{keyword}"</span>
			</p>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{spots.map(s => (
					<div key={s.label} className="flex items-center gap-1.5">
						{s.hit
							? <CheckCircle2 className="size-3 text-emerald-400" />
							: <XCircle className="size-3 text-red-400/60" />}
						<span className={clsx('text-xs', s.hit ? 'text-text-primary/60' : 'text-text-primary/35')}>{s.label}</span>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── PageSeoView ──────────────────────────────────────────────────────────────

interface PageSeoViewProps {
	page: SeoPage;
	htmlSignals?: HtmlSignals;
	onSendMessage: (msg: string) => void;
}

function PageSeoView({ page, htmlSignals, onSendMessage }: PageSeoViewProps) {
	const [draftTitle, setDraftTitle] = useState(page.title);
	const [draftDescription, setDraftDescription] = useState(page.description);
	const [draftKeywords, setDraftKeywords] = useState(() => normaliseKeywords(page.keywords));
	const [isEditingKeywords, setIsEditingKeywords] = useState(false);
	const [kwInput, setKwInput] = useState('');
	// Default to primary keyword so coverage is always visible
	const [selectedKw, setSelectedKw] = useState<string | null>(() => normaliseKeywords(page.keywords).primary || null);
	const kwInputRef = useRef<HTMLInputElement>(null);

	// Sync drafts when the underlying file updates (e.g. after LLM applies a fix)
	useEffect(() => {
		setDraftTitle(page.title);
		setDraftDescription(page.description);
		const kw = normaliseKeywords(page.keywords);
		setDraftKeywords(kw);
		// Keep selection on primary, or stay on current keyword if it still exists
		setSelectedKw(prev => {
			const allKws = [kw.primary, kw.longTail, ...kw.secondary].filter(Boolean);
			if (prev && allKws.includes(prev)) return prev;
			return kw.primary || null;
		});
	}, [page.title, page.description, page.keywords]);

	// Build a draft page that scorePage and KeywordCoverage both read from
	const draftPage = useMemo<SeoPage>(() => ({
		...page,
		title: draftTitle,
		description: draftDescription,
		keywords: draftKeywords,
	}), [page, draftTitle, draftDescription, draftKeywords]);

	const { checks, total, max } = useMemo(() => scorePage(draftPage, htmlSignals), [draftPage, htmlSignals]);
	const failingChecks = useMemo(() => checks.filter(c => !c.passed), [checks]);

	const titleState = fieldState(draftTitle.length, 50, 60, 40, 70);
	const descState = fieldState(draftDescription.length, 140, 160, 120, 170);
	const serpState = useMemo<FieldState>(() => {
		if (titleState === 'neutral' && descState === 'neutral') return 'neutral';
		if (titleState === 'green' && descState === 'green') return 'green';
		if (titleState === 'red' || descState === 'red') return 'red';
		return 'amber';
	}, [titleState, descState]);
	const checksPct = max > 0 ? Math.round((total / max) * 100) : 0;
	const checksState: FieldState = checksPct >= 90 ? 'green' : checksPct >= 70 ? 'amber' : 'red';

	// Dirty detection
	const originalKw = useMemo(() => normaliseKeywords(page.keywords), [page.keywords]);
	const isDirty = draftTitle !== page.title
		|| draftDescription !== page.description
		|| draftKeywords.primary !== originalKw.primary
		|| draftKeywords.longTail !== originalKw.longTail
		|| draftKeywords.secondary.join(',') !== originalKw.secondary.join(',');

	// Keyword pill list
	const kwPills = useMemo(() => {
		const arr: { kw: string; type: 'primary' | 'longTail' | 'secondary' }[] = [];
		if (draftKeywords.primary) arr.push({ kw: draftKeywords.primary, type: 'primary' });
		if (draftKeywords.longTail) arr.push({ kw: draftKeywords.longTail, type: 'longTail' });
		draftKeywords.secondary.forEach(s => arr.push({ kw: s, type: 'secondary' }));
		return arr;
	}, [draftKeywords]);

	// ── Keyword editing ──

	const addKwFromInput = () => {
		const val = kwInput.trim().toLowerCase();
		if (!val) return;
		if (!draftKeywords.primary) {
			setDraftKeywords(k => ({ ...k, primary: val }));
		} else if (!draftKeywords.longTail) {
			setDraftKeywords(k => ({ ...k, longTail: val }));
		} else {
			setDraftKeywords(k => ({ ...k, secondary: [...k.secondary, val] }));
		}
		setKwInput('');
	};

	const removeKw = (type: 'primary' | 'longTail' | 'secondary', secIdx?: number) => {
		if (type === 'primary') setDraftKeywords(k => ({ ...k, primary: '' }));
		else if (type === 'longTail') setDraftKeywords(k => ({ ...k, longTail: '' }));
		else if (secIdx !== undefined) setDraftKeywords(k => ({ ...k, secondary: k.secondary.filter((_, i) => i !== secIdx) }));
	};

	const handleKwKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addKwFromInput();
		} else if (e.key === 'Backspace' && !kwInput) {
			if (draftKeywords.secondary.length > 0) setDraftKeywords(k => ({ ...k, secondary: k.secondary.slice(0, -1) }));
			else if (draftKeywords.longTail) setDraftKeywords(k => ({ ...k, longTail: '' }));
			else if (draftKeywords.primary) setDraftKeywords(k => ({ ...k, primary: '' }));
		}
	};

	// ── LLM actions ──

	const handleSave = () => {
		const lines: string[] = [`Please update the SEO metadata for the ${page.label || 'home'} page:`];
		if (draftTitle !== page.title) lines.push(`- Page title: "${draftTitle}" (${draftTitle.length} chars)`);
		if (draftDescription !== page.description) lines.push(`- Meta description: "${draftDescription}" (${draftDescription.length} chars)`);
		const kwChanged = draftKeywords.primary !== originalKw.primary
			|| draftKeywords.longTail !== originalKw.longTail
			|| draftKeywords.secondary.join(',') !== originalKw.secondary.join(',');
		if (kwChanged) {
			if (draftKeywords.primary) lines.push(`- Primary keyword: "${draftKeywords.primary}"`);
			if (draftKeywords.longTail) lines.push(`- Long-tail keyword: "${draftKeywords.longTail}"`);
			if (draftKeywords.secondary.length > 0) lines.push(`- Secondary keywords: ${draftKeywords.secondary.map(s => `"${s}"`).join(', ')}`);
			lines.push(`\nUpdate seo.json keywords, revise title/H1/description to include the updated primary keyword, and set <meta name="keywords" content="${keywordsToMetaString(draftKeywords)}"> in index.html.`);
		} else {
			lines.push('\nUpdate seo.json and the corresponding <title> and <meta name="description"> tags in index.html.');
		}
		onSendMessage(lines.join('\n'));
		setIsEditingKeywords(false);
	};

	const handleFixAll = () => {
		const kw = draftKeywords;
		const lines: string[] = [`[DIRECT FILE EDIT — use read_files then regenerate_file, do NOT use queue_request]\nFix these SEO issues on the ${page.label || 'home'} page by updating seo.json and public/index.html directly:`];
		for (const check of failingChecks) {
			if (check.label === 'Primary keyword in title') lines.push(`- Add the primary keyword "${kw.primary}" to the page title. Current title: "${draftTitle}"`);
			else if (check.label === 'Primary keyword in H1') lines.push(`- Add the primary keyword "${kw.primary}" to the H1 heading`);
			else if (check.label === 'Long-tail keyword in description') lines.push(`- Include the long-tail phrase "${kw.longTail}" in the meta description. Current description: "${draftDescription}"`);
			else if (check.label === 'Primary keyword in description') lines.push(`- Include "${kw.primary}" in the meta description. Current description: "${draftDescription}"`);
			else if (check.label === 'Primary keyword in H2') lines.push(`- Add the primary keyword "${kw.primary}" to at least one H2 heading`);
			else if (check.label === 'Keyword in image alt text') lines.push(`- Add "${kw.primary}" to at least one image alt attribute`);
			else if (check.label.startsWith('Title length')) {
				if (draftTitle.length > 60) {
					// Compute the truncated value in JS — exact, not LLM-counted
					let trimmed = draftTitle.slice(0, 60);
					const lastSpace = trimmed.lastIndexOf(' ');
					if (lastSpace > 40) trimmed = trimmed.slice(0, lastSpace);
					lines.push(`- Set the page title to EXACTLY this string (${trimmed.length} chars — copy it verbatim, do not change a single character): "${trimmed}"`);
				} else {
					lines.push(`- Expand the page title to 50–60 characters (currently ${draftTitle.length} chars). Keep the primary keyword "${kw.primary}" and make it compelling.`);
				}
			} else if (check.label.startsWith('Description length')) {
				if (draftDescription.length > 160) {
					// Compute the truncated value in JS — exact, not LLM-counted
					let trimmed = draftDescription.slice(0, 160);
					const lastSpace = trimmed.lastIndexOf(' ');
					if (lastSpace > 120) trimmed = trimmed.slice(0, lastSpace);
					lines.push(`- Set the meta description to EXACTLY this string (${trimmed.length} chars — copy it verbatim, do not change a single character): "${trimmed}"`);
				} else {
					lines.push(`- Expand the meta description to 140–160 characters (currently ${draftDescription.length} chars). Keep the ${kw.longTail ? `long-tail phrase "${kw.longTail}"` : `primary keyword "${kw.primary}"`} and ensure it reads naturally.`);
				}
			}
			else if (check.label === 'H1 tag present') lines.push('- Add an H1 heading to the page');
			else if (check.label === 'At least 2 H2 tags') lines.push(`- Add at least 2 H2 headings (currently ${page.h2s.length})`);
			else if (check.label === 'Canonical URL set') lines.push('- Add a canonical URL to seo.json and <link rel="canonical"> in the HTML head');
			else if (check.label === 'Open Graph tags') lines.push('- Add Open Graph meta tags (og:title, og:description, og:url, og:type) to the HTML head');
			else if (check.label === 'OG image (social sharing card)') lines.push('- Add a social sharing card: `<meta property="og:image" content="[hero image URL]">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">` to the HTML head. Use the hero image URL if available.');
			else if (check.label === 'Favicon') lines.push('- Add a favicon: create a simple SVG file at /favicon.svg (square, brand colour background, business initial letter in white) and add `<link rel="icon" href="/favicon.svg">` and `<link rel="apple-touch-icon" href="/favicon.svg">` to the HTML head.');
			else if (check.label === 'Structured data (JSON-LD)') lines.push('- Add JSON-LD WebPage structured data to the HTML head');
		}
		lines.push('\nUpdate seo.json and index.html accordingly.');
		onSendMessage(lines.join('\n'));
	};

	return (
		<div className="flex flex-col gap-5">
			{/* Score row */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-text-primary/70">Page score</h3>
				<div className="flex items-center gap-2">
					{failingChecks.length > 0 && (
						<button
							onClick={handleFixAll}
							className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
						>
							Fix all ({failingChecks.length})
						</button>
					)}
					<ScoreBadge score={total} max={max} />
				</div>
			</div>

			{/* SERP preview — live */}
			<SerpPreview title={draftTitle} description={draftDescription} url={page.canonicalUrl} state={serpState} />

			{/* Title */}
			<div>
				<div className="flex items-center justify-between mb-1">
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">Page title</label>
					<CharCounter value={draftTitle} min={50} max={60} />
				</div>
				<input
					type="text"
					value={draftTitle}
					onChange={e => setDraftTitle(e.target.value)}
					className={clsx(
						'w-full rounded-md bg-bg-3 border outline-none px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent/40',
						STATE_BORDER[titleState],
					)}
					placeholder="No title set"
				/>
				<p className="text-xs text-text-primary/30 mt-1">50–60 chars. Include primary keyword and location.</p>
			</div>

			{/* Description */}
			<div>
				<div className="flex items-center justify-between mb-1">
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">Meta description</label>
					<CharCounter value={draftDescription} min={140} max={160} />
				</div>
				<textarea
					value={draftDescription}
					onChange={e => setDraftDescription(e.target.value)}
					rows={3}
					className={clsx(
						'w-full rounded-md bg-bg-3 border outline-none px-3 py-2 text-sm text-text-primary leading-relaxed resize-none transition-colors focus:border-accent/40',
						STATE_BORDER[descState],
					)}
					placeholder="No description set"
				/>
				<p className="text-xs text-text-primary/30 mt-0.5">140–160 chars (max 160). Include primary keyword naturally.</p>
			</div>

			{/* Keywords */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">Target keywords</label>
					<button
						onClick={() => { setIsEditingKeywords(e => !e); setKwInput(''); setSelectedKw(null); setTimeout(() => kwInputRef.current?.focus(), 50); }}
						className="flex items-center gap-1 text-xs text-text-primary/40 hover:text-accent transition-colors"
					>
						{isEditingKeywords ? <Check className="size-3" /> : <Pencil className="size-3" />}
						{isEditingKeywords ? 'Done' : 'Edit'}
					</button>
				</div>

				{kwPills.length === 0 && !isEditingKeywords ? (
					<p className="text-xs text-text-primary/25">No keywords set — click Edit to add them, or ask Orange.</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{kwPills.map((item, i) => {
							const isSelected = selectedKw === item.kw && !isEditingKeywords;
							const pillColor = item.type === 'primary'
								? 'bg-accent/20 text-accent'
								: item.type === 'longTail'
									? 'bg-blue-400/15 text-blue-400'
									: 'bg-text-primary/10 text-text-primary/50';
							const typeLabel = item.type === 'primary' ? 'Primary' : item.type === 'longTail' ? 'Long-tail' : 'Secondary';
							return (
								<div key={`${item.type}-${i}`} className="flex items-center gap-2">
									<span className="text-xs text-text-primary/30 w-16 flex-shrink-0">{typeLabel}</span>
									<button
										onClick={() => !isEditingKeywords && setSelectedKw(item.kw)}
										className={clsx(
											'px-2.5 py-0.5 rounded-full text-xs font-medium transition-all',
											pillColor,
											!isEditingKeywords && 'hover:opacity-80 cursor-pointer',
											isSelected && 'ring-1 ring-offset-1 ring-offset-bg-1 ring-current',
										)}
									>
										{item.kw}
									</button>
									{isEditingKeywords && (
										<button
											onClick={() => removeKw(item.type, item.type === 'secondary' ? draftKeywords.secondary.indexOf(item.kw) : undefined)}
											className="text-text-primary/30 hover:text-red-400 transition-colors"
										>
											<X className="size-3" />
										</button>
									)}
								</div>
							);
						})}
					</div>
				)}

				{/* Per-keyword coverage breakdown */}
				{selectedKw && (
					<KeywordCoverage keyword={selectedKw} page={draftPage} />
				)}

				{/* Keyword input */}
				{isEditingKeywords && (
					<div className="mt-2.5 flex flex-col gap-1.5">
						<div className="flex gap-2">
							<input
								ref={kwInputRef}
								type="text"
								value={kwInput}
								onChange={e => setKwInput(e.target.value)}
								onKeyDown={handleKwKeyDown}
								placeholder={
									!draftKeywords.primary ? 'Add primary keyword…'
									: !draftKeywords.longTail ? 'Add long-tail keyword…'
									: 'Add secondary keyword…'
								}
								className="flex-1 rounded-md bg-bg-3 border border-text-primary/10 focus:border-accent/40 outline-none px-3 py-1.5 text-xs text-text-primary placeholder:text-text-primary/25 transition-colors"
							/>
							<button
								onClick={addKwFromInput}
								disabled={!kwInput.trim()}
								className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-30 transition-colors"
							>
								Add
							</button>
						</div>
						<p className="text-xs text-text-primary/25">1st = primary · 2nd = long-tail · rest = secondary · Enter or comma to add</p>
					</div>
				)}
			</div>

			{/* H1 / H2s */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider block mb-1">H1</label>
					<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-2 text-sm text-text-primary">
						{page.h1 || <span className="text-text-primary/30">Not set</span>}
					</div>
				</div>
				<div>
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider block mb-1">H2s ({page.h2s.length})</label>
					<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-2 text-sm text-text-primary/70 space-y-0.5 max-h-[80px] overflow-y-auto">
						{page.h2s.length > 0
							? page.h2s.map((h, i) => <div key={i} className="truncate">{h}</div>)
							: <span className="text-text-primary/30">None</span>}
					</div>
				</div>
			</div>

			{/* Checklist */}
			<div>
				<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider block mb-2">SEO checks</label>
				<div className={clsx('rounded-md bg-bg-3 border px-3 py-1 transition-colors', STATE_BORDER[checksState])}>
					{checks.map((c, i) => <CheckRow key={i} check={c} />)}
				</div>
			</div>

			{/* Save bar — only shown when something has changed */}
			{isDirty && (
				<div className="sticky bottom-0 pt-2 pb-1 bg-gradient-to-t from-bg-1 via-bg-1 to-transparent">
					<button
						onClick={handleSave}
						className="w-full py-2.5 rounded-md text-sm font-medium bg-accent text-bg-1 hover:bg-accent/90 transition-colors"
					>
						Save changes
					</button>
				</div>
			)}
		</div>
	);
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface SeoPanelProps {
	seoFile?: FileType;
	htmlFile?: FileType;
	isGenerating: boolean;
	onSendMessage: (msg: string) => void;
}

export function SeoPanel({ seoFile, htmlFile, isGenerating, onSendMessage }: SeoPanelProps) {
	const [selectedPageIndex, setSelectedPageIndex] = useState(0);
	const [pageDropdownOpen, setPageDropdownOpen] = useState(false);

	const seoData = useMemo<SeoData | null>(() => {
		if (!seoFile?.fileContents) return null;
		try {
			const parsed = JSON.parse(seoFile.fileContents) as { pages?: Partial<SeoPage>[] };
			if (!parsed?.pages) return null;
			return { pages: parsed.pages.map(normalisePage) };
		} catch {
			return null;
		}
	}, [seoFile]);

	const htmlSignals = useMemo<HtmlSignals | undefined>(() => {
		if (!htmlFile?.fileContents) return undefined;
		return detectFromHtml(htmlFile.fileContents);
	}, [htmlFile]);

	if (isGenerating && !seoData) {
		return (
			<div className="flex-1 flex items-center justify-center text-text-primary/30 text-sm">
				Generating SEO data…
			</div>
		);
	}

	if (!seoData || seoData.pages.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
				<div className="space-y-1">
					<p className="text-text-primary/50 text-sm font-medium">No SEO data yet</p>
					<p className="text-text-primary/30 text-xs max-w-xs">
						Generate SEO metadata, page titles, descriptions, and keyword targeting for this website.
					</p>
				</div>
				<button
					onClick={() => onSendMessage(
`[DIRECT FILE EDIT — use read_files then regenerate_file, do NOT use queue_request]
Create a seo.json file in the project root with this exact structure (fill in real values based on the actual website content):

{
  "pages": [
    {
      "path": "/",
      "label": "Home",
      "title": "Page title 50-60 chars including primary keyword",
      "description": "Meta description 140-160 chars, include primary keyword naturally, compelling call to action",
      "keywords": {
        "primary": "main keyword phrase",
        "longTail": "longer descriptive keyword phrase",
        "secondary": ["keyword2", "keyword3", "keyword4"]
      },
      "h1": "Exact H1 text from the page",
      "h2s": ["H2 heading 1", "H2 heading 2"],
      "imageAlts": ["alt text for hero image", "alt text for other images"],
      "canonicalUrl": "https://yourdomain.com/",
      "hasOgTags": true,
      "hasOgImage": true,
      "hasStructuredData": true,
      "hasFavicon": true
    }
  ]
}

Also update index.html head with: correct <title>, <meta name="description">, Open Graph tags (og:title, og:description, og:url, og:image, og:type, og:site_name), <link rel="canonical">, and <link rel="icon">. If no favicon exists, create a simple SVG at /favicon.svg (square, brand colour background, first letter of business name in white) and reference it with <link rel="icon" href="/favicon.svg">. Do this now — create the files directly.`
					)}
					className="px-4 py-2 rounded-md bg-accent text-black text-sm font-medium hover:bg-accent/90 transition-colors"
				>
					Generate SEO data
				</button>
			</div>
		);
	}

	const pages = seoData.pages;
	const currentPage = pages[Math.min(selectedPageIndex, pages.length - 1)];
	const multiPage = pages.length > 1;

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-3 sm:px-5 py-4 max-w-2xl mx-auto w-full">
				{multiPage && (
					<div className="relative mb-5">
						<button
							onClick={() => setPageDropdownOpen(o => !o)}
							className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-bg-3 border border-text-primary/10 text-sm text-text-primary hover:border-accent/40 transition-colors"
						>
							<span>{currentPage.label} <span className="text-text-primary/40 text-xs ml-1">{currentPage.path}</span></span>
							<ChevronDown className={clsx('size-4 text-text-primary/40 transition-transform', pageDropdownOpen && 'rotate-180')} />
						</button>
						{pageDropdownOpen && (
							<div className="absolute top-full left-0 right-0 mt-1 rounded-md bg-bg-2 border border-text-primary/10 shadow-lg z-20 overflow-hidden">
								{pages.map((p, i) => (
									<button
										key={p.path}
										onClick={() => { setSelectedPageIndex(i); setPageDropdownOpen(false); }}
										className={clsx('w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-bg-3 transition-colors', i === selectedPageIndex ? 'text-accent' : 'text-text-primary')}
									>
										<span>{p.label}</span>
										<span className="text-text-primary/30 text-xs">{p.path}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{/* key=path resets PageSeoView draft state when switching pages */}
				<PageSeoView key={currentPage.path} page={currentPage} htmlSignals={htmlSignals} onSendMessage={onSendMessage} />
			</div>
		</div>
	);
}
