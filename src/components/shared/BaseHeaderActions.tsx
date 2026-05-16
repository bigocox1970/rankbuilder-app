import type { RefObject } from 'react';
import { GitBranch, Github, Expand, RefreshCw, Monitor, Tablet, Smartphone } from 'lucide-react';
import { HeaderButton } from '@/components/shared/header-actions';
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

const VIEWPORT_BUTTONS: { mode: ViewportMode; Icon: typeof Monitor; title: string }[] = [
	{ mode: 'desktop', Icon: Monitor, title: 'Desktop view' },
	{ mode: 'tablet', Icon: Tablet, title: 'Tablet view (768px)' },
	{ mode: 'mobile', Icon: Smartphone, title: 'Mobile view (390px)' },
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
			{viewportMode && onViewportChange && (
				<div className="flex items-center border border-border-primary rounded-md overflow-hidden">
					{VIEWPORT_BUTTONS.map(({ mode, Icon, title }) => (
						<button
							key={mode}
							onClick={() => onViewportChange(mode)}
							title={title}
							className={`p-1.5 transition-colors duration-150 ${
								viewportMode === mode
									? 'bg-accent text-black'
									: 'text-text-primary/50 hover:text-text-primary hover:bg-bg-4'
							}`}
						>
							<Icon className="size-4" />
						</button>
					))}
				</div>
			)}
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
