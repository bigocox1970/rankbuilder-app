import type { RefObject } from 'react';
import { GitBranch, Github, Expand } from 'lucide-react';
import { ModelConfigInfo } from '@/components/shared/ModelConfigInfo';
import { HeaderButton } from '@/components/shared/header-actions';
import type { ModelConfigsInfo } from '@/api-types';

export interface BaseHeaderActionsProps {
	containerRef: RefObject<HTMLElement | null>;
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	fallbackUrl?: string;
}

export function BaseHeaderActions({
	containerRef,
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	fallbackUrl,
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
			<ModelConfigInfo
				configs={modelConfigs}
				onRequestConfigs={onRequestConfigs}
				loading={loadingConfigs}
			/>
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
