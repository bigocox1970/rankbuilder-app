import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { HeaderActionsProps } from '../../core/types';

export function AppHeaderActions({
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	previewUrl,
	expoTunnelUrl,
	templateDetails,
	onManualRefresh,
	viewportMode,
	onViewportChange,
}: HeaderActionsProps) {
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
			// Thread Expo data through so the header can hide the no-op viewport toggle
			// and show the QR / "Open in Expo Go" button for Expo builds.
			templateName={templateDetails?.name}
			previewUrl={previewUrl}
			expoTunnelUrl={expoTunnelUrl}
		/>
	);
}
