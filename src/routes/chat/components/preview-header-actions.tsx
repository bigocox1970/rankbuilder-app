import type { RefObject } from 'react';
import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { ViewportMode } from '@/features/core/types';

interface PreviewHeaderActionsProps {
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	previewRef: RefObject<HTMLIFrameElement | null>;
	previewUrl?: string;
	onManualRefresh?: () => void;
	viewportMode?: ViewportMode;
	onViewportChange?: (mode: ViewportMode) => void;
}

export function PreviewHeaderActions({
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	previewUrl,
	onManualRefresh,
	viewportMode,
	onViewportChange,
}: PreviewHeaderActionsProps) {
	return (
		<BaseHeaderActions
			containerRef={previewRef}
			onGitCloneClick={onGitCloneClick}
			isGitHubExportReady={isGitHubExportReady}
			onGitHubExportClick={onGitHubExportClick}
			fallbackUrl={previewUrl}
			onManualRefresh={onManualRefresh}
			viewportMode={viewportMode}
			onViewportChange={onViewportChange}
		/>
	);
}
