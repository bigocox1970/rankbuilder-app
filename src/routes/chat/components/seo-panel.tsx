import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { FileType } from '@/api-types';

// ─── Types ───────────────────────────────────────────────────────────────────

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
	// Supports structured { primary, longTail, secondary[] } or legacy string[]
	keywords: SeoKeywords | string[];
	h1: string;
	h2s: string[];
	imageAlts: string[];
	canonicalUrl: string;
	hasOgTags: boolean;
	hasStructuredData: boolean;
}

function normaliseKeywords(raw: SeoKeywords | string[]): SeoKeywords {
	if (Array.isArray(raw)) {
		return {
			primary: raw[0] ?? '',
			longTail: raw[1] ?? '',
			secondary: raw.slice(2),
		};
	}
	return raw;
}

interface SeoData {
	pages: SeoPage[];
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface ScoreCheck {
	label: string;
	passed: boolean;
	partial?: boolean;
	detail?: string;
	points: number;
	earned: number;
}

function scorePage(page: SeoPage): { checks: ScoreCheck[]; total: number; max: number } {
	const checks: ScoreCheck[] = [];
	const kw = normaliseKeywords(page.keywords);
	const primary = kw.primary.toLowerCase();
	const longTail = kw.longTail.toLowerCase();

	const titleLower = page.title.toLowerCase();
	const descLower = page.description.toLowerCase();
	const h1Lower = page.h1.toLowerCase();
	const h2Lower = page.h2s.map(h => h.toLowerCase()).join(' ');
	const altLower = page.imageAlts.map(a => a.toLowerCase()).join(' ');

	const titleLen = page.title.length;
	const descLen = page.description.length;

	// Primary keyword in title (15 pts)
	if (primary) {
		const passed = titleLower.includes(primary);
		checks.push({ label: 'Primary keyword in title', passed, points: 15, earned: passed ? 15 : 0, detail: passed ? undefined : `"${primary}" missing` });
	}

	// Primary keyword in H1 (15 pts)
	if (primary) {
		const passed = h1Lower.includes(primary);
		checks.push({ label: 'Primary keyword in H1', passed, points: 15, earned: passed ? 15 : 0, detail: passed ? undefined : `"${primary}" missing` });
	}

	// Long-tail keyword in description (12 pts)
	if (longTail) {
		const passed = descLower.includes(longTail);
		checks.push({ label: 'Long-tail keyword in description', passed, points: 12, earned: passed ? 12 : 0, detail: passed ? undefined : `"${longTail}" missing` });
	} else if (primary) {
		// Fall back to primary if no long-tail
		const passed = descLower.includes(primary);
		checks.push({ label: 'Primary keyword in description', passed, points: 12, earned: passed ? 12 : 0, detail: passed ? undefined : `"${primary}" missing` });
	}

	// Primary keyword in H2 (8 pts)
	if (primary) {
		const passed = h2Lower.includes(primary);
		checks.push({ label: 'Primary keyword in H2', passed, points: 8, earned: passed ? 8 : 0 });
	}

	// Primary or long-tail in image alts (8 pts)
	if (primary || longTail) {
		const passed = altLower.includes(primary) || (longTail ? altLower.includes(longTail) : false);
		checks.push({ label: 'Keyword in image alt text', passed, points: 8, earned: passed ? 8 : 0 });
	}

	// Title length (10 pts: full if 50–60, partial if 40–70)
	{
		const perfect = titleLen >= 50 && titleLen <= 60;
		const ok = titleLen >= 40 && titleLen <= 70;
		checks.push({
			label: 'Title length (50–60 chars)',
			passed: perfect,
			partial: !perfect && ok,
			points: 10,
			earned: perfect ? 10 : ok ? 5 : 0,
			detail: `${titleLen} chars`,
		});
	}

	// Description length (10 pts: full if 150–160, partial if 120–200)
	{
		const perfect = descLen >= 150 && descLen <= 160;
		const ok = descLen >= 120 && descLen <= 200;
		checks.push({
			label: 'Description length (150–160 chars)',
			passed: perfect,
			partial: !perfect && ok,
			points: 10,
			earned: perfect ? 10 : ok ? 5 : 0,
			detail: `${descLen} chars`,
		});
	}

	// H1 present (5 pts)
	{
		const passed = page.h1.trim().length > 0;
		checks.push({ label: 'H1 tag present', passed, points: 5, earned: passed ? 5 : 0 });
	}

	// H2s present (5 pts)
	{
		const passed = page.h2s.length >= 2;
		checks.push({ label: 'At least 2 H2 tags', passed, points: 5, earned: passed ? 5 : 0, detail: `${page.h2s.length} found` });
	}

	// Canonical URL (5 pts)
	{
		const passed = page.canonicalUrl.trim().length > 0;
		checks.push({ label: 'Canonical URL set', passed, points: 5, earned: passed ? 5 : 0 });
	}

	// OG tags (4 pts)
	checks.push({ label: 'Open Graph tags', passed: page.hasOgTags, points: 4, earned: page.hasOgTags ? 4 : 0 });

	// Structured data (3 pts)
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
			<span className={clsx('text-xl font-bold tabular-nums', color)}>{score}</span>
			<span className="text-text-primary/40 text-xs">/{max}</span>
			<span className={clsx('text-xs font-medium', color)}>{label}</span>
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
			{check.detail && (
				<span className="text-xs text-text-primary/30 tabular-nums">{check.detail}</span>
			)}
			<span className="text-xs tabular-nums text-text-primary/30 w-8 text-right">+{check.earned}</span>
		</div>
	);
}

function CharCounter({ value, min, max }: { value: string; min: number; max: number }) {
	const len = value.length;
	const color = len >= min && len <= max
		? 'text-emerald-400'
		: len >= min * 0.8 && len <= max * 1.2
			? 'text-yellow-400'
			: 'text-red-400/70';
	return (
		<span className={clsx('text-xs tabular-nums', color)}>{len}/{max}</span>
	);
}

function SerpPreview({ title, description, url }: { title: string; description: string; url: string }) {
	const displayUrl = url || 'https://yoursite.com';
	return (
		<div className="rounded-lg bg-white/5 border border-text-primary/10 p-4 text-left">
			<p className="text-xs text-text-primary/30 mb-2 uppercase tracking-wider">Google preview</p>
			<div className="flex items-center gap-1.5 mb-0.5">
				<div className="size-4 rounded-full bg-text-primary/20" />
				<span className="text-xs text-text-primary/50 truncate">{displayUrl}</span>
			</div>
			<p className="text-[15px] text-blue-400 font-medium leading-snug truncate">
				{title || 'Page title will appear here'}
			</p>
			<p className="text-xs text-text-primary/60 mt-0.5 leading-relaxed line-clamp-2">
				{description || 'Meta description will appear here. Make it compelling and around 150–160 characters.'}
			</p>
		</div>
	);
}

function PageSeoView({ page }: { page: SeoPage }) {
	const { checks, total, max } = useMemo(() => scorePage(page), [page]);

	return (
		<div className="flex flex-col gap-5">
			{/* Score */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-text-primary/70">Page score</h3>
				<ScoreBadge score={total} max={max} />
			</div>

			{/* SERP preview */}
			<SerpPreview title={page.title} description={page.description} url={page.canonicalUrl} />

			{/* Title */}
			<div>
				<div className="flex items-center justify-between mb-1">
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">Page title</label>
					<CharCounter value={page.title} min={50} max={60} />
				</div>
				<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-2 text-sm text-text-primary">
					{page.title || <span className="text-text-primary/30">Not set</span>}
				</div>
				<p className="text-xs text-text-primary/30 mt-1">Aim for 50–60 characters. Include primary keyword and location.</p>
			</div>

			{/* Description */}
			<div>
				<div className="flex items-center justify-between mb-1">
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">Meta description</label>
					<CharCounter value={page.description} min={150} max={160} />
				</div>
				<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-2 text-sm text-text-primary leading-relaxed">
					{page.description || <span className="text-text-primary/30">Not set</span>}
				</div>
				<p className="text-xs text-text-primary/30 mt-1">Aim for 150–160 characters. Include primary keyword naturally.</p>
			</div>

			{/* Keywords */}
			{(() => {
				const kw = normaliseKeywords(page.keywords);
				const hasAny = kw.primary || kw.longTail || kw.secondary.length > 0;
				if (!hasAny) return null;
				return (
					<div>
						<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider block mb-2">Target keywords</label>
						<div className="flex flex-col gap-1.5">
							{kw.primary && (
								<div className="flex items-center gap-2">
									<span className="text-xs text-text-primary/30 w-16 flex-shrink-0">Primary</span>
									<span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs font-medium">{kw.primary}</span>
								</div>
							)}
							{kw.longTail && (
								<div className="flex items-center gap-2">
									<span className="text-xs text-text-primary/30 w-16 flex-shrink-0">Long-tail</span>
									<span className="px-2 py-0.5 rounded-full bg-blue-400/15 text-blue-400 text-xs font-medium">{kw.longTail}</span>
								</div>
							)}
							{kw.secondary.length > 0 && (
								<div className="flex items-start gap-2">
									<span className="text-xs text-text-primary/30 w-16 flex-shrink-0 pt-0.5">Secondary</span>
									<div className="flex flex-wrap gap-1.5">
										{kw.secondary.map(s => (
											<span key={s} className="px-2 py-0.5 rounded-full bg-text-primary/10 text-text-primary/50 text-xs">{s}</span>
										))}
									</div>
								</div>
							)}
						</div>
					</div>
				);
			})()}

			{/* H1 / H2s */}
			<div className="grid grid-cols-2 gap-3">
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
				<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-1">
					{checks.map((c, i) => <CheckRow key={i} check={c} />)}
				</div>
			</div>
		</div>
	);
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface SeoPanelProps {
	seoFile?: FileType;
	isGenerating: boolean;
}

export function SeoPanel({ seoFile, isGenerating }: SeoPanelProps) {
	const [selectedPageIndex, setSelectedPageIndex] = useState(0);
	const [pageDropdownOpen, setPageDropdownOpen] = useState(false);

	const seoData = useMemo<SeoData | null>(() => {
		if (!seoFile?.fileContents) return null;
		try {
			return JSON.parse(seoFile.fileContents) as SeoData;
		} catch {
			return null;
		}
	}, [seoFile]);

	if (isGenerating && !seoData) {
		return (
			<div className="flex-1 flex items-center justify-center text-text-primary/30 text-sm">
				Generating SEO data…
			</div>
		);
	}

	if (!seoData || seoData.pages.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
				<p className="text-text-primary/40 text-sm">No SEO data yet</p>
				<p className="text-text-primary/25 text-xs">Add target keywords when creating your site and SEO data will appear here automatically.</p>
			</div>
		);
	}

	const pages = seoData.pages;
	const currentPage = pages[Math.min(selectedPageIndex, pages.length - 1)];
	const multiPage = pages.length > 1;

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-5 py-4 max-w-2xl mx-auto">
				{/* Page selector (only shown for multi-page sites) */}
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
										className={clsx(
											'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-bg-3 transition-colors',
											i === selectedPageIndex ? 'text-accent' : 'text-text-primary',
										)}
									>
										<span>{p.label}</span>
										<span className="text-text-primary/30 text-xs">{p.path}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}

				<PageSeoView page={currentPage} />
			</div>
		</div>
	);
}
