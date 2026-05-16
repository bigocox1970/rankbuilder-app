import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { HeaderActionsProps } from '../../core/types';

export function AppHeaderActions({
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	previewUrl,
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
		/>
	);
}
