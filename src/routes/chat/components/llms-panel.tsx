import { useMemo } from 'react';
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import type { FileType } from '@/api-types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmsCheck {
	label: string;
	passed: boolean;
	partial?: boolean;
	points: number;
	earned: number;
	detail?: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface SeoPageRef {
	title?: string;
	h1?: string;
	h2s?: string[];
	description?: string;
}

function keywordDensity(content: string, keyword: string): string {
	const words = content.trim().split(/\s+/).length;
	const lc = content.toLowerCase();
	const kw = keyword.toLowerCase();
	let count = 0;
	let pos = 0;
	while ((pos = lc.indexOf(kw, pos)) !== -1) { count++; pos += kw.length; }
	if (words === 0 || count === 0) return '0 mentions';
	const pct = ((kw.split(' ').length * count / words) * 100).toFixed(1);
	return `${count} mention${count !== 1 ? 's' : ''} (${pct}% density)`;
}

function scoreLlmsTxt(content: string, primaryKeyword?: string, seoPage?: SeoPageRef): { checks: LlmsCheck[]; total: number; max: number } {
	const checks: LlmsCheck[] = [];
	const lc = content.toLowerCase();

	// Structure checks
	const hasH1 = /^#\s+.{2,}/m.test(content);
	checks.push({ label: 'Business name as title (# heading)', passed: hasH1, points: 5, earned: hasH1 ? 5 : 0 });

	const hasBlockquote = /^>\s+.{20,}/m.test(content);
	checks.push({ label: 'Summary paragraph (> blockquote)', passed: hasBlockquote, points: 10, earned: hasBlockquote ? 10 : 0 });

	const hasServices = /##\s+(services|what we do|our work|our services)/i.test(content);
	checks.push({ label: 'Services section', passed: hasServices, points: 8, earned: hasServices ? 8 : 0 });

	const hasAreas = /##\s+(service area|areas|location|where we (work|cover))/i.test(content)
		|| /(serving|covering|based in|located in)/i.test(content);
	checks.push({ label: 'Location / service areas', passed: hasAreas, points: 8, earned: hasAreas ? 8 : 0 });

	const hasContact = /##\s+contact/i.test(content)
		|| /(phone|tel|mob|email|website|https?:\/\/)/i.test(content);
	checks.push({ label: 'Contact details', passed: hasContact, points: 8, earned: hasContact ? 8 : 0 });

	// Page content cross-checks (requires seoPage)
	if (seoPage?.title) {
		// Check that key title words appear in llms.txt
		const titleWords = seoPage.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
		const titleCovered = titleWords.length > 0 && titleWords.filter(w => lc.includes(w)).length >= Math.ceil(titleWords.length * 0.6);
		checks.push({
			label: 'Page title reflected',
			passed: titleCovered,
			points: 5,
			earned: titleCovered ? 5 : 0,
			detail: seoPage.title.slice(0, 40) + (seoPage.title.length > 40 ? '…' : ''),
		});
	}

	if (seoPage?.h1) {
		const h1Words = seoPage.h1.toLowerCase().split(/\s+/).filter(w => w.length > 3);
		const h1Covered = h1Words.length > 0 && h1Words.filter(w => lc.includes(w)).length >= Math.ceil(h1Words.length * 0.6);
		checks.push({
			label: 'H1 heading reflected',
			passed: h1Covered,
			points: 5,
			earned: h1Covered ? 5 : 0,
			detail: seoPage.h1.slice(0, 40) + (seoPage.h1.length > 40 ? '…' : ''),
		});
	}

	if (seoPage?.h2s && seoPage.h2s.length > 0) {
		const h2Topics = seoPage.h2s.map(h => h.toLowerCase().split(/\s+/).filter(w => w.length > 3));
		const covered = h2Topics.filter(words => words.some(w => lc.includes(w))).length;
		const pct = Math.round((covered / seoPage.h2s.length) * 100);
		const passed = pct >= 50;
		checks.push({
			label: 'H2 topics mentioned',
			passed,
			partial: !passed && pct >= 25,
			points: 5,
			earned: passed ? 5 : pct >= 25 ? 2 : 0,
			detail: `${covered}/${seoPage.h2s.length} headings`,
		});
	}

	if (seoPage?.description) {
		// Check that the description's key phrases are echoed in the summary
		const descWords = seoPage.description.toLowerCase().split(/\s+/).filter(w => w.length > 4);
		const descCovered = descWords.length > 0 && descWords.filter(w => lc.includes(w)).length >= Math.ceil(descWords.length * 0.4);
		checks.push({
			label: 'Meta description topics covered',
			passed: descCovered,
			points: 5,
			earned: descCovered ? 5 : 0,
		});
	}

	// Technical checks
	const len = content.trim().length;
	const goodLength = len >= 150 && len <= 2000;
	const okLength = len >= 80 && len <= 4000;
	checks.push({
		label: 'Content length (150–2000 chars)',
		passed: goodLength,
		partial: !goodLength && okLength,
		points: 5,
		earned: goodLength ? 5 : okLength ? 2 : 0,
		detail: `${len} chars`,
	});

	const hasNoHtml = !/<[a-z][^>]*>/i.test(content);
	checks.push({ label: 'Plain markdown (no HTML tags)', passed: hasNoHtml, points: 4, earned: hasNoHtml ? 4 : 0 });

	if (primaryKeyword) {
		const kw = primaryKeyword.toLowerCase();
		const hasKw = lc.includes(kw);
		checks.push({
			label: 'Primary keyword present',
			passed: hasKw,
			points: 10,
			earned: hasKw ? 10 : 0,
			detail: hasKw ? keywordDensity(content, primaryKeyword) : `"${primaryKeyword}" missing`,
		});
	}

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

function CheckRow({ check }: { check: LlmsCheck }) {
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
			{check.detail && <span className="text-xs text-text-primary/30">{check.detail}</span>}
			<span className="text-xs tabular-nums text-text-primary/30 w-8 text-right">+{check.earned}</span>
		</div>
	);
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
			<div className="size-12 rounded-full bg-accent/10 flex items-center justify-center">
				<Sparkles className="size-6 text-accent" />
			</div>
			<div>
				<p className="text-sm font-medium text-text-primary/70 mb-1">No llms.txt yet</p>
				<p className="text-xs text-text-primary/35 max-w-xs">
					Help AI assistants like ChatGPT, Perplexity, and Claude understand this business. Takes seconds to generate.
				</p>
			</div>
			<button
				onClick={onGenerate}
				className="px-4 py-2 rounded-md text-sm font-medium bg-accent text-bg-1 hover:bg-accent/90 transition-colors"
			>
				Generate llms.txt
			</button>
		</div>
	);
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface LlmsPanelProps {
	llmsFile?: FileType;
	seoFile?: FileType;
	onSendMessage: (msg: string) => void;
}

export function LlmsPanel({ llmsFile, seoFile, onSendMessage }: LlmsPanelProps) {
	const { primaryKeyword, seoPage } = useMemo(() => {
		if (!seoFile?.fileContents) return { primaryKeyword: undefined, seoPage: undefined };
		try {
			const data = JSON.parse(seoFile.fileContents) as { pages?: Array<{ title?: string; h1?: string; h2s?: string[]; description?: string; keywords?: { primary?: string } | string[] }> };
			const page = data.pages?.[0];
			if (!page) return { primaryKeyword: undefined, seoPage: undefined };
			const kw = page.keywords;
			const primary = kw ? (Array.isArray(kw) ? kw[0] : kw.primary) : undefined;
			return {
				primaryKeyword: primary,
				seoPage: { title: page.title, h1: page.h1, h2s: page.h2s, description: page.description } satisfies SeoPageRef,
			};
		} catch {
			return { primaryKeyword: undefined, seoPage: undefined };
		}
	}, [seoFile]);

	const content = llmsFile?.fileContents ?? '';
	const { checks, total, max } = useMemo(() => scoreLlmsTxt(content, primaryKeyword, seoPage), [content, primaryKeyword, seoPage]);
	const failingChecks = checks.filter(c => !c.passed);

	const handleGenerate = () => {
		onSendMessage(
			'Please create a `llms.txt` file at the project root following the llmstxt.org standard. ' +
			'Include: the business name as an H1, a summary blockquote with the primary keyword, a Services section, ' +
			'a Service Areas section, contact details, and a short About paragraph. ' +
			'Keep it under 2000 characters and use pure markdown with no HTML tags.'
		);
	};

	const handleRefresh = () => {
		onSendMessage(
			'Please refresh the `llms.txt` file to make sure it accurately reflects the current services, ' +
			'contact details, location, and business description from the site. ' +
			'Keep it under 2000 characters and use pure markdown with no HTML tags.'
		);
	};

	const handleFixAll = () => {
		const lines: string[] = ['Please fix the following issues in `llms.txt`:'];
		for (const check of failingChecks) {
			switch (check.label) {
				case 'Business name as title (# heading)':
					lines.push('- Add the business name as an H1 heading at the top of the file (e.g. `# Business Name`)');
					break;
				case 'Summary paragraph (> blockquote)':
					lines.push('- Add a summary blockquote immediately after the title: `> [1–2 sentences describing the business, trade, location, and key USPs]`');
					break;
				case 'Services section':
					lines.push('- Add a `## Services` section listing every service offered as bullet points');
					break;
				case 'Location / service areas':
					lines.push('- Add a `## Service Areas` section listing the primary town/city and surrounding areas');
					break;
				case 'Contact details':
					lines.push('- Add contact details under a `## Contact` section (phone number, website URL)');
					break;
				case 'Content length (150–2000 chars)':
					lines.push(`- Adjust content length to between 150–2000 characters (currently ${content.trim().length} chars)`);
					break;
				case 'Plain markdown (no HTML tags)':
					lines.push('- Remove all HTML tags — the entire file must be pure markdown with no `<div>`, `<p>`, `<br>` or similar');
					break;
				case 'Primary keyword present':
					lines.push(`- Include the primary keyword "${primaryKeyword ?? ''}" naturally in the summary blockquote`);
					break;
				case 'Page title reflected':
					lines.push(`- Reflect the page title content in the summary — mention the key trade and location words from: "${seoPage?.title ?? ''}"`);
					break;
				case 'H1 heading reflected':
					lines.push(`- Echo the main H1 heading topic in the llms.txt summary or services description. H1 is: "${seoPage?.h1 ?? ''}"`);
					break;
				case 'H2 topics mentioned': {
					const h2List = seoPage?.h2s?.slice(0, 4).map(h => `"${h}"`).join(', ') ?? '';
					lines.push(`- Mention the main section topics from the site's headings: ${h2List}`);
					break;
				}
				case 'Meta description topics covered':
					lines.push('- Ensure the core topics from the meta description are covered in the llms.txt summary');
					break;
			}
		}
		if (lines.length > 1) {
			lines.push('\nUpdate `llms.txt` accordingly. Keep it under 2000 characters and use pure markdown only.');
			onSendMessage(lines.join('\n'));
		}
	};

	if (!llmsFile) {
		return (
			<div className="flex-1 overflow-y-auto">
				<div className="px-3 sm:px-5 py-4 max-w-2xl mx-auto w-full">
					<EmptyState onGenerate={handleGenerate} />
					<div className="mt-8 rounded-md bg-bg-3 border border-text-primary/10 px-4 py-3">
						<p className="text-xs font-medium text-text-primary/50 mb-2">Why llms.txt matters</p>
						<p className="text-xs text-text-primary/40 leading-relaxed">
							Like <code className="text-text-primary/60">robots.txt</code> for web crawlers, <code className="text-text-primary/60">llms.txt</code> is a plain-text file that tells AI assistants exactly what this business does.
							When someone asks ChatGPT or Perplexity for a tradesperson in the area, sites with clear <code className="text-text-primary/60">llms.txt</code> files are more likely to be surfaced.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-3 sm:px-5 py-4 max-w-2xl mx-auto w-full flex flex-col gap-5">
				{/* Score row */}
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium text-text-primary/70">AI discoverability score</h3>
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

				{/* Content preview */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider">llms.txt</label>
						<button
							onClick={handleRefresh}
							className="flex items-center gap-1.5 text-xs text-text-primary/40 hover:text-accent transition-colors"
						>
							<RefreshCw className="size-3" />
							Refresh
						</button>
					</div>
					<pre className="w-full rounded-md bg-bg-3 border border-text-primary/10 px-4 py-3 text-xs text-text-primary/70 leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono">
						{content || <span className="text-text-primary/25">Empty file</span>}
					</pre>
				</div>

				{/* Checklist */}
				<div>
					<label className="text-xs font-medium text-text-primary/50 uppercase tracking-wider block mb-2">Checks</label>
					<div className="rounded-md bg-bg-3 border border-text-primary/10 px-3 py-1">
						{checks.map((c, i) => <CheckRow key={i} check={c} />)}
					</div>
				</div>

				{/* What is llms.txt */}
				<div className="rounded-md bg-bg-3 border border-text-primary/10 px-4 py-3">
					<p className="text-xs font-medium text-text-primary/50 mb-1">What is llms.txt?</p>
					<p className="text-xs text-text-primary/35 leading-relaxed">
						A plain-text file (llmstxt.org standard) that tells AI assistants what a site is about.
						When someone asks ChatGPT or Perplexity for a local tradesperson, sites with a well-formed <code className="text-text-primary/55">llms.txt</code> are more likely to be referenced in the answer.
					</p>
				</div>
			</div>
		</div>
	);
}
