import type { RefObject } from 'react';
import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { ModelConfigsInfo } from '@/api-types';

interface PreviewHeaderActionsProps {
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	previewRef: RefObject<HTMLIFrameElement | null>;
	previewUrl?: string;
	onManualRefresh?: () => void;
}

export function PreviewHeaderActions({
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	previewUrl,
	onManualRefresh,
}: PreviewHeaderActionsProps) {
	return (
		<BaseHeaderActions
			containerRef={previewRef}
			modelConfigs={modelConfigs}
			onRequestConfigs={onRequestConfigs}
			loadingConfigs={loadingConfigs}
			onGitCloneClick={onGitCloneClick}
			isGitHubExportReady={isGitHubExportReady}
			onGitHubExportClick={onGitHubExportClick}
			fallbackUrl={previewUrl}
			onManualRefresh={onManualRefresh}
		/>
	);
}
