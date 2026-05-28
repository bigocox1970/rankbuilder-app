import type { RefObject } from 'react';
import { GitBranch, Github, Expand, RefreshCw, Monitor, Tablet, Smartphone } from 'lucide-react';
import { HeaderButton } from '@/components/shared/header-actions';
import { SupabaseHeaderButton } from '@/components/supabase/SupabaseHeaderButton';
import type { ViewportMode } from '@/features/core/types';

export interface BaseHeaderActionsProps {
	containerRef: RefObject<HTMLElement | null>;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	fallbackUrl?: string;
	onManualRefresh?: () => void;
	viewportMode?: ViewportMode;
	onViewportChange?: (mode: ViewportMode) => void;
}

const VIEWPORT_CYCLE: { mode: ViewportMode; Icon: typeof Monitor; label: string }[] = [
	{ mode: 'desktop', Icon: Monitor, label: 'Desktop' },
	{ mode: 'tablet', Icon: Tablet, label: 'Tablet (768px)' },
	{ mode: 'mobile', Icon: Smartphone, label: 'Mobile (390px)' },
];

export function BaseHeaderActions({
	containerRef,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	fallbackUrl,
	onManualRefresh,
	viewportMode,
	onViewportChange,
}: BaseHeaderActionsProps) {
	const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

	const handleExpand = () => {
		const el = containerRef.current;
		if (canFullscreen && el?.requestFullscreen) {
			el.requestFullscreen().catch(() => {
				if (fallbackUrl) window.open(fallbackUrl, '_blank');
			});
		}
	};

	return (
		<>
			{onManualRefresh && (
				<HeaderButton
					icon={RefreshCw}
					onClick={onManualRefresh}
					title="Refresh preview"
					iconOnly
				/>
			)}
			{viewportMode && onViewportChange && (() => {
				const currentIndex = VIEWPORT_CYCLE.findIndex(v => v.mode === viewportMode);
				const current = VIEWPORT_CYCLE[currentIndex] ?? VIEWPORT_CYCLE[0];
				const next = VIEWPORT_CYCLE[(currentIndex + 1) % VIEWPORT_CYCLE.length];
				const CurrentIcon = current.Icon;
				return (
					<HeaderButton
						icon={CurrentIcon}
						onClick={() => onViewportChange(next.mode)}
						title={`Viewport: ${current.label} — click for ${next.label}`}
						iconOnly
					/>
				);
			})()}
			<SupabaseHeaderButton />
			<HeaderButton
				icon={GitBranch}
				label="Clone"
				onClick={onGitCloneClick}
				title="Clone to local machine"
			/>
			{isGitHubExportReady && (
				<HeaderButton
					icon={Github}
					label="GitHub"
					onClick={onGitHubExportClick}
					title="Export to GitHub"
				/>
			)}
			{canFullscreen ? (
				<HeaderButton
					icon={Expand}
					onClick={handleExpand}
					title="Fullscreen"
					iconOnly
				/>
			) : fallbackUrl ? (
				<a
					href={fallbackUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="p-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm"
					title="Open in new tab"
				>
					<Expand className="size-4 text-text-primary/50 hover:text-accent transition-colors duration-200" />
				</a>
			) : null}
		</>
	);
}
