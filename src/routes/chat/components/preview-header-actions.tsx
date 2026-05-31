import type { RefObject } from 'react';
import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { ViewportMode } from '@/features/core/types';

interface PreviewHeaderActionsProps {
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	previewRef: RefObject<HTMLIFrameElement | null>;
	previewUrl?: string;
	expoTunnelUrl?: string;
	onManualRefresh?: () => void;
	viewportMode?: ViewportMode;
	onViewportChange?: (mode: ViewportMode) => void;
	templateName?: string;
}

export function PreviewHeaderActions({
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	previewUrl,
	expoTunnelUrl,
	onManualRefresh,
	viewportMode,
	onViewportChange,
	templateName,
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
			templateName={templateName}
			previewUrl={previewUrl}
			expoTunnelUrl={expoTunnelUrl}
		/>
	);
}
