import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { ArrowRight, Info } from 'react-feather';
import { Loader2, LayoutGrid, List, Code2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { ProjectModeSelector, type ProjectModeOption } from '../components/project-mode-selector';
import { MAX_AGENT_QUERY_LENGTH, SUPPORTED_IMAGE_MIME_TYPES, type ProjectType } from '@/api-types';
import { useFeature } from '@/features';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { usePaginatedApps } from '@/hooks/use-paginated-apps';
import { useRecentApps } from '@/hooks/use-apps';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { AppCard } from '@/components/shared/AppCard';
import clsx from 'clsx';
import { useImageUpload } from '@/hooks/use-image-upload';
import { useDragDrop } from '@/hooks/use-drag-drop';
import { toast } from 'sonner';
import { useLimitsContext } from '@/contexts/limits-context';
import { checkCanSendPrompt } from '@/utils/usage-limit-checker';
import { PromptBox } from '@/components/prompt-box';

type StackType = 'website' | 'app';

const WEBSITE_TEMPLATE = 'tradesperson-sp';

export default function Home() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const { requireAuth } = useAuthGuard();
	const [projectMode, setProjectMode] = useState<ProjectType>('app');
	const [stack, setStack] = useState<StackType>('website');
	const [query, setQuery] = useState('');
	const [keywords, setKeywords] = useState<string[]>([]);

	// Pre-fill prompt when arriving from Lovable import modal
	useEffect(() => {
		const importUrl = searchParams.get('import');
		if (importUrl) {
			setQuery(`Import my Lovable project from GitHub: ${importUrl} — make it SEO-friendly, add structured data, and deploy to Cloudflare`);
			setStack('website');
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const { user } = useAuth();
	const { isLoadingCapabilities, capabilities, getEnabledFeatures } = useFeature();
	const { data: limitsData, loading: usageLimitsLoading } = useLimitsContext();
	const [showLimitDialog, setShowLimitDialog] = useState<React.ReactElement | null>(null);

	const handleConnectCloudflare = useCallback(() => {
		window.location.href = `/oauth/login?return_url=${encodeURIComponent(window.location.href)}`;
	}, []);

	const modeOptions = useMemo<ProjectModeOption[]>(() => {
		if (isLoadingCapabilities || !capabilities) return [];
		return getEnabledFeatures().map((def) => ({
			id: def.id,
			label:
				def.id === 'presentation'
					? 'Slides'
					: def.id === 'general'
						? 'General'
						: 'App',
			description: def.description,
		}));
	}, [capabilities, getEnabledFeatures, isLoadingCapabilities]);

	const showModeSelector = modeOptions.length > 1;

	useEffect(() => {
		if (isLoadingCapabilities) return;
		if (modeOptions.length === 0) {
			if (projectMode !== 'app') setProjectMode('app');
			return;
		}
		if (!modeOptions.some((m) => m.id === projectMode)) {
			setProjectMode(modeOptions[0].id);
		}
	}, [isLoadingCapabilities, modeOptions, projectMode]);

	const { images, addImages, removeImage, clearImages, isProcessing } = useImageUpload({
		onError: (error) => {
			console.error('Image upload error:', error);
			toast.error(error);
		},
	});

	const { isDragging, dragHandlers } = useDragDrop({
		onFilesDropped: addImages,
		accept: [...SUPPORTED_IMAGE_MIME_TYPES],
	});


	const placeholderPhrases = useMemo(() => stack === 'website' ? [
		"plumber in Manchester",
		"local carpenter in Oxford",
		"electrician serving Bristol",
		"roofing company in Leeds",
	] : [
		"todo list app",
		"F1 fantasy game",
		"personal finance tracker",
	], [stack]);

	const {
		apps,
		loading,
	} = usePaginatedApps({
		type: 'public',
		defaultSort: 'popular',
		defaultPeriod: 'week',
		limit: 6,
	});

	// Discover section should appear only when enough apps are available and loading is done
	const discoverReady = useMemo(() => !loading && (apps?.length ?? 0) > 5, [loading, apps]);

	const { apps: recentApps } = useRecentApps();

	const [recentViewMode, setRecentViewMode] = useState<'grid' | 'list'>(() => {
		try { return (localStorage.getItem('recent.viewMode') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; }
	});

	const handleRecentViewModeChange = (mode: 'grid' | 'list') => {
		setRecentViewMode(mode);
		try { localStorage.setItem('recent.viewMode', mode); } catch { /* ignore */ }
	};

	const [discoverViewMode, setDiscoverViewMode] = useState<'grid' | 'list'>(() => {
		try { return (localStorage.getItem('discover.viewMode') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; }
	});

	const handleDiscoverViewModeChange = (mode: 'grid' | 'list') => {
		setDiscoverViewMode(mode);
		try { localStorage.setItem('discover.viewMode', mode); } catch { /* ignore */ }
	};

	const handleCreateApp = (query: string, mode: ProjectType) => {
		if (query.length > MAX_AGENT_QUERY_LENGTH) {
			toast.error(
				`Prompt too large (${query.length} characters). Maximum allowed is ${MAX_AGENT_QUERY_LENGTH} characters.`,
			);
			return;
		}

		if (user && usageLimitsLoading) {
			return;
		}

		const encodedQuery = encodeURIComponent(query);
		const encodedMode = encodeURIComponent(mode);

		// Encode images as JSON if present
		const imageParam = images.length > 0 ? `&images=${encodeURIComponent(JSON.stringify(images))}` : '';
		const templateParam = stack === 'website' ? `&selectedTemplate=${WEBSITE_TEMPLATE}` : '';
		const imageGenEnabled = (() => { try { return localStorage.getItem('imageGeneration.enabled') !== 'false'; } catch { return true; } })();
		const imageGenParam = (!imageGenEnabled || stack !== 'website') ? '&imageGeneration=0' : '';
		const keywordsParam = keywords.length > 0 ? `&keywords=${encodeURIComponent(keywords.join(','))}` : '';
		const intendedUrl = `/chat/new?query=${encodedQuery}&projectType=${encodedMode}${imageParam}${templateParam}${imageGenParam}${keywordsParam}`;

		if (
			!requireAuth({
				requireFullAuth: true,
				actionContext: 'to create applications',
				intendedUrl: intendedUrl,
			})
		) {
			return;
		}

		// Check usage limits before proceeding
		const limitCheck = checkCanSendPrompt(
			limitsData,
			usageLimitsLoading,
			() => { window.location.href = `/oauth/login?return_url=${encodeURIComponent(window.location.href)}`; },
			() => setShowLimitDialog(null)
		);

		if (!limitCheck.canProceed) {
			setShowLimitDialog(limitCheck.dialogComponent || null);
			return;
		}

		// User is already authenticated, navigate immediately
		navigate(intendedUrl);
		// Clear images after navigation
		clearImages();
	};


	const discoverLinkRef = useRef<HTMLDivElement>(null);

	return (
		<div className="relative flex flex-col items-center size-full overflow-y-auto">
			{/* Radial glow background matching marketing site */}
			<div className="fixed inset-0 z-0 pointer-events-none">
				<div className="absolute inset-0" style={{
					background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,230,118,0.10) 0%, transparent 70%)'
				}} />
			</div>

			{/* Top spacer — flexes to fill space but caps out so content doesn't drop too low */}
			<div className="flex-1 min-h-[1rem] max-h-[20vh]" />

			<LayoutGroup>
				<div className="rounded-md w-full max-w-2xl overflow-hidden">
					<motion.div
						layout
						transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
						className="px-6 p-8 flex flex-col items-center z-10"
					>
						<h1 className="font-bold leading-[1.1] tracking-tight text-5xl w-full mb-6 text-text-primary">
							What should we <span style={{ color: '#00E676' }}>build</span> today?
						</h1>

						{/* Website / App selector */}
						<div className="flex gap-2 w-full mb-4">
							<button
								type="button"
								onClick={() => setStack('website')}
								className={`flex-1 flex flex-col items-start px-4 py-3 rounded-xl border transition-all duration-200 text-left ${
									stack === 'website'
										? 'border-accent bg-accent/10 text-text-primary'
										: 'border-text-primary/10 bg-bg-2/50 text-text-primary/50 hover:border-text-primary/20 hover:text-text-primary/70'
								}`}
							>
								<span className="text-sm font-medium">Website</span>
								<span className="text-xs mt-0.5 opacity-70">Pre-rendered HTML · Google-ready</span>
							</button>
							<button
								type="button"
								onClick={() => setStack('app')}
								className={`flex-1 flex flex-col items-start px-4 py-3 rounded-xl border transition-all duration-200 text-left ${
									stack === 'app'
										? 'border-accent bg-accent/10 text-text-primary'
										: 'border-text-primary/10 bg-bg-2/50 text-text-primary/50 hover:border-text-primary/20 hover:text-text-primary/70'
								}`}
							>
								<span className="text-sm font-medium">App</span>
								<span className="text-xs mt-0.5 opacity-70">React · Interactive tools &amp; dashboards</span>
							</button>
						</div>

						<PromptBox
							value={query}
							onChange={setQuery}
							onSubmit={() => handleCreateApp(query, projectMode)}
							placeholder={stack === 'website' ? 'Website for a ' : 'Create a '}
							animatedPlaceholder
							placeholderPhrases={placeholderPhrases}
							images={images}
							onAddImages={addImages}
							onRemoveImage={removeImage}
							isProcessing={isProcessing || (user ? usageLimitsLoading : false)}
							isDragging={isDragging}
							dragHandlers={dragHandlers}
							submitDisabled={user ? usageLimitsLoading : false}
							limitsData={user ? limitsData : undefined}
							onConnectCloudflare={handleConnectCloudflare}
							variant="expanded"
							submitIcon={user && usageLimitsLoading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
							keywords={keywords}
							onKeywordsChange={setKeywords}
							showKeywords={stack === 'website'}
							leftActions={
								stack === 'app' && showModeSelector ? (
									<ProjectModeSelector
										value={projectMode}
										onChange={setProjectMode}
										modes={modeOptions}
										className="flex-1"
									/>
								) : undefined
							}
						/>
					</motion.div>

				</div>

				<AnimatePresence>
					{images.length > 0 && (
						<motion.div
							initial={{ opacity: 0, y: -10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							className="w-full max-w-2xl px-6"
						>
							<div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-bg-4/50 dark:bg-bg-2/50 border border-accent/20 dark:border-accent/30 shadow-sm">
								<Info className="size-4 text-accent flex-shrink-0 mt-0.5" />
								<p className="text-xs text-text-tertiary leading-relaxed">
									<span className="font-medium text-text-secondary">Images Beta:</span> Images guide app layout and design but may not be replicated exactly. The coding agent cannot access images directly for app assets.
								</p>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Recent apps — shown below input when user is logged in */}
				<AnimatePresence>
					{user && (
						<motion.section
							key="recent-apps"
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 10 }}
							transition={{ duration: 0.3 }}
							className={cn("px-6 mt-6 pb-8 z-10 w-full", recentViewMode === 'grid' ? "max-w-4xl" : "max-w-2xl")}
						>
							<div className="flex items-center justify-between mb-3">
								<h2 className="text-sm font-medium text-text-tertiary uppercase tracking-widest">Recent projects</h2>
								<div className="flex items-center gap-3">
									<button
										className="text-xs text-accent hover:underline underline-offset-2"
										onClick={() => navigate('/apps')}
									>
										View all
									</button>
									<div className="flex items-center rounded-md border border-border/50 overflow-hidden">
										<button
											onClick={() => handleRecentViewModeChange('grid')}
											className={cn("p-1.5 transition-colors", recentViewMode === 'grid' ? "bg-bg-4 text-text-primary" : "text-text-tertiary hover:text-text-secondary")}
											aria-label="Grid view"
										>
											<LayoutGrid className="h-3.5 w-3.5" />
										</button>
										<button
											onClick={() => handleRecentViewModeChange('list')}
											className={cn("p-1.5 transition-colors", recentViewMode === 'list' ? "bg-bg-4 text-text-primary" : "text-text-tertiary hover:text-text-secondary")}
											aria-label="List view"
										>
											<List className="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							</div>
							{recentViewMode === 'grid' ? (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
									{recentApps.slice(0, 4).map((app) => (
										<AppCard
											key={app.id}
											app={app}
											onClick={() => navigate(`/chat/${app.id}`)}
											showStats={false}
											showUser={false}
											showActions={false}
										/>
									))}
									{Array.from({ length: Math.max(0, 4 - recentApps.length) }).map((_, i) => (
										<div
											key={`placeholder-${i}`}
											className="aspect-[4/3] rounded-md border border-dashed border-border/40 bg-bg-1/30 flex flex-col items-center justify-center gap-2 opacity-40"
										>
											<Code2 className="h-6 w-6 text-text-tertiary" />
											<span className="text-xs text-text-tertiary">No project yet</span>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col gap-1">
									{recentApps.slice(0, 4).map((app) => (
										<button
											key={app.id}
											onClick={() => navigate(`/chat/${app.id}`)}
											className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-4/60 transition-colors text-left group"
										>
											<div className="w-2 h-2 rounded-full bg-accent/60 flex-shrink-0" />
											<span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors truncate flex-1">
												{app.title}
											</span>
											<span className="text-xs text-text-tertiary flex-shrink-0">
												{app.updatedAtFormatted ?? 'Recently'}
											</span>
										</button>
									))}
									{Array.from({ length: Math.max(0, 4 - recentApps.length) }).map((_, i) => (
										<div
											key={`placeholder-${i}`}
											className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-30"
										>
											<div className="w-2 h-2 rounded-full border border-dashed border-text-tertiary flex-shrink-0" />
											<span className="text-sm text-text-tertiary italic">No project yet</span>
										</div>
									))}
								</div>
							)}
						</motion.section>
					)}
				</AnimatePresence>

				<AnimatePresence>
					{discoverReady && (
						<motion.section
							key="discover-section"
							layout
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
							className={clsx('max-w-6xl mx-auto px-4 z-10', images.length > 0 ? 'mt-10' : 'mt-16 mb-8')}
						>
							<div className='flex flex-col items-start w-full'>
								<h2 className="text-2xl font-medium text-text-secondary/80">Discover Apps built by the community</h2>
								<div className="flex items-center gap-3 mb-4">
									<div ref={discoverLinkRef} className="text-md font-light text-text-tertiary hover:underline underline-offset-4 select-text cursor-pointer" onClick={() => navigate('/discover')}>View All</div>
									<div className="flex items-center rounded-md border border-border/50 overflow-hidden">
										<button
											onClick={() => handleDiscoverViewModeChange('grid')}
											className={cn("p-1.5 transition-colors", discoverViewMode === 'grid' ? "bg-bg-4 text-text-primary" : "text-text-tertiary hover:text-text-secondary")}
											aria-label="Grid view"
										>
											<LayoutGrid className="h-4 w-4" />
										</button>
										<button
											onClick={() => handleDiscoverViewModeChange('list')}
											className={cn("p-1.5 transition-colors", discoverViewMode === 'list' ? "bg-bg-4 text-text-primary" : "text-text-tertiary hover:text-text-secondary")}
											aria-label="List view"
										>
											<List className="h-4 w-4" />
										</button>
									</div>
								</div>
								{discoverViewMode === 'list' ? (
									<div className="flex flex-col gap-0.5 w-full">
										{apps.map(app => (
											<a
												key={app.id}
												href={`/app/${app.id}`}
												onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}`); }}
												className="no-underline flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-4/40 transition-colors cursor-pointer group"
											>
												<div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/20 dark:to-red-900/20">
													{app.screenshotUrl ? (
														<img src={app.screenshotUrl} alt={app.title} className="w-full h-full object-cover" loading="lazy" />
													) : (
														<div className="w-full h-full flex items-center justify-center">
															<Code2 className="h-4 w-4 text-red-400/50" />
														</div>
													)}
												</div>
												<div className="flex-1 min-w-0">
													<div className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">{app.title}</div>
													{'userName' in app && app.userName && (
														<div className="text-xs text-text-tertiary">{app.userName}</div>
													)}
												</div>
											</a>
										))}
									</div>
								) : (
								<motion.div
									layout
									transition={{ duration: 0.4 }}
									className="grid grid-cols-2 xl:grid-cols-3 gap-6"
								>
									<AnimatePresence mode="popLayout">
										{apps.map(app => (
											<AppCard
												key={app.id}
												app={app}
												onClick={() => navigate(`/app/${app.id}`)}
												showStats={true}
												showUser={true}
												showActions={false}
											/>
										))}
									</AnimatePresence>
								</motion.div>
								)}
							</div>
						</motion.section>
					)}
				</AnimatePresence>
			</LayoutGroup>

			{/* Nudge towards Discover */}
			{user && <CurvedArrow sourceRef={discoverLinkRef} target={{ x: 50, y: window.innerHeight - 60 }} />}

			{/* Usage limit dialogs */}
			{showLimitDialog}
		</div>
	);
}



type ArrowProps = {
	/** Ref to the source element the arrow starts from */
	sourceRef: React.RefObject<HTMLElement | null>;
	/** Target point in viewport/client coordinates */
	target: { x: number; y: number };
	/** Curve intensity (0.1 - 1.5 is typical) */
	curvature?: number;
	/** Optional pixel offset from source element edge */
	sourceOffset?: number;
	/** If true, hides the arrow when the source is offscreen/not measurable */
	hideWhenInvalid?: boolean;
};

type Point = { x: number; y: number };

export const CurvedArrow: React.FC<ArrowProps> = ({
	sourceRef,
	target,
	curvature = 0.5,
	sourceOffset = 6,
	hideWhenInvalid = true,
}) => {
	const [start, setStart] = useState<Point | null>(null);
	const [end, setEnd] = useState<Point | null>(null);

	const rafRef = useRef<number | null>(null);
	const roRef = useRef<ResizeObserver | null>(null);

	const compute = () => {
		const el = sourceRef.current;
		if (!el) {
			setStart(null);
			setEnd(null);
			return;
		}

		const rect = el.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) {
			setStart(null);
			setEnd(null);
			return;
		}

		const endPoint: Point = { x: target.x, y: target.y };

		// Choose an anchor on the source: midpoint of the side facing the target
		const centers = {
			right: { x: rect.right, y: rect.top + rect.height / 2 },
			left: { x: rect.left, y: rect.top + rect.height / 2 },
		};

		// Distances to target from each side center
		const dists = Object.fromEntries(
			Object.entries(centers).map(([side, p]) => [
				side,
				(p.x - endPoint.x) ** 2 + (p.y - endPoint.y) ** 2,
			])
		) as Record<keyof typeof centers, number>;

		const bestSide = (Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0] ||
			"right") as keyof typeof centers;

		// Nudge start point slightly outside the element for visual clarity
		const nudge = (p: Point, side: keyof typeof centers, offset: number) => {
			switch (side) {
				case "right":
					return { x: p.x + offset, y: p.y };
				case "left":
					return { x: p.x - offset, y: p.y };
			}
		};

		const startPoint = nudge(centers[bestSide], bestSide, sourceOffset);

		setStart(startPoint);
		setEnd(endPoint);
	};

	// Throttle updates with rAF to avoid layout thrash
	const scheduleCompute = () => {
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(compute);
	};

	useEffect(() => {
		scheduleCompute();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target.x, target.y, sourceRef.current]);

	useEffect(() => {
		const onScroll = () => scheduleCompute();
		const onResize = () => scheduleCompute();

		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onResize);

		// Track source element size changes
		const el = sourceRef.current;
		if ("ResizeObserver" in window) {
			roRef.current = new ResizeObserver(() => scheduleCompute());
			if (el) roRef.current.observe(el);
		}

		scheduleCompute();

		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			if (roRef.current && el) roRef.current.unobserve(el);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const d = useMemo(() => {
		if (!start || !end) return "";

		const dx = end.x - start.x;
		const dy = end.y - start.y;

		// Control points: bend the curve based on the primary axis difference.
		// This gives a nice S or C curve without sharp kinks.
		const cpOffset = Math.max(Math.abs(dx), Math.abs(dy)) * curvature;

		const c1: Point = { x: start.x + cpOffset * (dx >= 0 ? 1 : -1), y: start.y };
		const c2: Point = { x: end.x - cpOffset * (dx >= 0 ? 1 : -1), y: end.y };

		return `M ${start.x},${start.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
	}, [start, end, curvature]);

	const hidden = hideWhenInvalid && (!start || !end);

	if (start && end && (end.y - start.y > 420 || start.x - end.x < 100)) {
		return null;
	}

	return (
		<svg
			aria-hidden="true"
			style={{
				position: "fixed",
				inset: 0,
				width: "100vw",
				height: "100vh",
				pointerEvents: "none",
				overflow: "visible",
				zIndex: 9999,
				display: hidden ? "none" : "block",
			}}
		>
			<defs>
				<filter id="discover-squiggle" x="-20%" y="-20%" width="140%" height="140%">
					<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="3" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="1" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<marker id="discover-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth" opacity={0.20}>
					<path d="M 0 1.2 L 7 4" stroke="var(--color-text-tertiary)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
					<path d="M 0 6.8 L 7 4" stroke="var(--color-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
				</marker>
			</defs>

			<path
				d={d}
				// stroke="var(--color-accent)"
				stroke="var(--color-text-tertiary)"
				strokeOpacity={0.20}
				strokeWidth={1.6}
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
				markerEnd="url(#discover-arrowhead)"
			/>
			{/* Soft squiggle overlay for hand-drawn feel */}
			<g filter="url(#discover-squiggle)">
				<path
					d={d}
					// stroke="var(--color-accent)"
					stroke="var(--color-text-tertiary)"
					strokeOpacity={0.12}
					strokeWidth={1}
					fill="none"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray="8 6 4 9 5 7"
					vectorEffect="non-scaling-stroke"
				/>
			</g>
		</svg>
	);
};
