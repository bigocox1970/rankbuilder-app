import type { RefObject } from 'react';
import { strToU8, zipSync } from 'fflate';
import { Download } from 'lucide-react';
import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import { HeaderButton } from '@/components/shared/header-actions';
import type { ModelConfigsInfo, FileType } from '@/api-types';

interface EditorHeaderActionsProps {
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	editorRef: RefObject<HTMLDivElement | null>;
	allFiles?: FileType[];
}

function downloadZip(files: FileType[]) {
	const entries: Record<string, Uint8Array> = {};
	for (const file of files) {
		entries[file.filePath] = strToU8(file.fileContents ?? '');
	}
	const zipped = zipSync(entries);
	const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'project.zip';
	a.click();
	URL.revokeObjectURL(url);
}

export function EditorHeaderActions({
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	editorRef,
	allFiles,
}: EditorHeaderActionsProps) {
	return (
		<>
			{allFiles && allFiles.length > 0 && (
				<HeaderButton
					icon={Download}
					onClick={() => downloadZip(allFiles)}
					title="Download project as ZIP"
					iconOnly
				/>
			)}
			<BaseHeaderActions
				containerRef={editorRef}
				modelConfigs={modelConfigs}
				onRequestConfigs={onRequestConfigs}
				loadingConfigs={loadingConfigs}
				onGitCloneClick={onGitCloneClick}
				isGitHubExportReady={isGitHubExportReady}
				onGitHubExportClick={onGitHubExportClick}
			/>
		</>
	);
}
