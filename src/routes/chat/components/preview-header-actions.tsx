import type { RefObject } from 'react';
import { MousePointer2, PenLine } from 'lucide-react';
import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { ViewportMode } from '@/features/core/types';

type SelectorMode = 'off' | 'select' | 'edit';

interface PreviewHeaderActionsProps {
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	previewRef: RefObject<HTMLIFrameElement | null>;
	previewUrl?: string;
	onManualRefresh?: () => void;
	viewportMode?: ViewportMode;
	onViewportChange?: (mode: ViewportMode) => void;
	selectorMode?: SelectorMode;
	onSelectorModeChange?: (mode: SelectorMode) => void;
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
	selectorMode,
	onSelectorModeChange,
}: PreviewHeaderActionsProps) {
	return (
		<div className="flex items-center gap-1">
			{onSelectorModeChange && (
				<div className="flex items-center border border-border-primary rounded-md overflow-hidden mr-1">
					<button
						onClick={() => onSelectorModeChange(selectorMode === 'select' ? 'off' : 'select')}
						className={`p-1.5 transition-colors ${selectorMode === 'select' ? 'bg-accent text-white' : 'text-text-primary/50 hover:text-text-primary hover:bg-bg-3'}`}
						title="Click element to reference in chat"
					>
						<MousePointer2 className="size-3.5" />
					</button>
					<button
						onClick={() => onSelectorModeChange(selectorMode === 'edit' ? 'off' : 'edit')}
						className={`p-1.5 transition-colors ${selectorMode === 'edit' ? 'bg-accent text-white' : 'text-text-primary/50 hover:text-text-primary hover:bg-bg-3'}`}
						title="Click text to edit inline"
					>
						<PenLine className="size-3.5" />
					</button>
				</div>
			)}
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
		</div>
	);
}
