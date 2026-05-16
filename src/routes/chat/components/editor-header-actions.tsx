import type { RefObject } from 'react';
import { useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { Download, Loader } from 'lucide-react';
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
	generatedImages?: Record<string, string>;
}

const SLOT_EXTENSIONS: Record<string, string> = {
	hero: 'hero.png',
	work1: 'work1.png',
	work2: 'work2.png',
};

async function buildZip(files: FileType[], generatedImages?: Record<string, string>): Promise<Blob> {
	const entries: Record<string, Uint8Array> = {};

	// Fetch generated images and build a URL→local-path replacement map
	const replacements: Array<{ pattern: RegExp; localPath: string }> = [];

	if (generatedImages) {
		const imageSlots = Object.entries(generatedImages).filter(
			([, url]) => url && !url.includes('/undefined/')
		);

		await Promise.all(
			imageSlots.map(async ([slot, url]) => {
				try {
					const res = await fetch(url, { credentials: 'omit' });
					if (!res.ok) return;
					const buf = await res.arrayBuffer();
					const filename = SLOT_EXTENSIONS[slot] ?? `${slot}.png`;
					entries[`public/images/${filename}`] = new Uint8Array(buf);

					// Match any URL that references this slot (strip query string variant)
					const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\?v=\d+/, '(?:\\?v=\\d+)?');
					replacements.push({ pattern: new RegExp(escaped, 'g'), localPath: `images/${filename}` });
				} catch {
					// Skip images that fail to fetch — don't block the rest of the ZIP
				}
			})
		);
	}

	// Add all code files, rewriting image URLs to relative paths
	for (const file of files) {
		let contents = file.fileContents ?? '';
		for (const { pattern, localPath } of replacements) {
			contents = contents.replace(pattern, localPath);
		}
		entries[file.filePath] = strToU8(contents);
	}

	const zipped = zipSync(entries);
	return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
}

function triggerDownload(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function EditorHeaderActions({
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	editorRef,
	allFiles,
	generatedImages,
}: EditorHeaderActionsProps) {
	const [downloading, setDownloading] = useState(false);

	const handleDownload = async () => {
		if (!allFiles || allFiles.length === 0 || downloading) return;
		setDownloading(true);
		try {
			const blob = await buildZip(allFiles, generatedImages);
			triggerDownload(blob, 'project.zip');
		} finally {
			setDownloading(false);
		}
	};

	return (
		<>
			{allFiles && allFiles.length > 0 && (
				<HeaderButton
					icon={downloading ? Loader : Download}
					onClick={handleDownload}
					title="Download project as ZIP"
					iconOnly
				/>
			)}
			<BaseHeaderActions
				containerRef={editorRef}
				onGitCloneClick={onGitCloneClick}
				isGitHubExportReady={isGitHubExportReady}
				onGitHubExportClick={onGitHubExportClick}
			/>
		</>
	);
}
