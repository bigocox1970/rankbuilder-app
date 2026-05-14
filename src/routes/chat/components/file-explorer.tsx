import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LucideNetwork, ChevronRight, File, Image, Trash2 } from 'lucide-react';
import type { FileType } from '@/api-types';
import clsx from 'clsx';

interface FileTreeItem {
	name: string;
	type: 'file' | 'folder';
	filePath: string;
	children?: { [key: string]: FileTreeItem };
	file?: FileType;
}

export function FileTreeItem({
	item,
	level = 0,
	currentFile,
	onFileClick,
}: {
	item: FileTreeItem;
	level?: number;
	currentFile: FileType | undefined;
	onFileClick: (file: FileType) => void;
}) {
	const [isExpanded, setIsExpanded] = useState(true);
	const isCurrentFile = currentFile?.filePath === item.filePath;

	if (item.type === 'file' && item.file) {
		return (
			<button
				onClick={() => onFileClick(item.file!)}
				className={`flex items-center w-full gap-2 py-1 px-3 transition-colors text-sm ${
					isCurrentFile
						? 'text-brand bg-zinc-100'
						: 'text-text-primary/80 hover:bg-accent hover:text-text-primary'
				}`}
				style={{ paddingLeft: `${level * 12 + 12}px` }}
			>
				<File className="size-3" />
				<span className="flex-1 text-left truncate">{item.name}</span>
				{/* {item.file.isGenerating ? (
					<Loader className="size-3 animate-spin" />
				) : null}
				{item.file.needsFixing && (
					<span className="text-[9px] text-orange-400">fix</span>
				)}
				{item.file.hasRuntimeError && (
					<span className="text-[9px] text-red-400">error</span>
				)} */}
			</button>
		);
	}

	return (
		<div>
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-2 py-1 px-3 transition-colors text-sm text-text-primary/80 hover:bg-accent hover:text-text-primary w-full"
				style={{ paddingLeft: `${level * 12 + 12}px` }}
			>
				<ChevronRight
					className={clsx(
						'size-3 transition-transform duration-200 ease-in-out',
						isExpanded && 'rotate-90',
					)}
				/>
				<span className="flex-1 text-left truncate">{item.name}</span>
			</button>
			{isExpanded && item.children && (
				<div>
					{Object.values(item.children).map((child) => (
						<FileTreeItem
							key={child.filePath}
							item={child}
							level={level + 1}
							currentFile={currentFile}
							onFileClick={onFileClick}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function buildFileTree(files: FileType[]): FileTreeItem[] {
	const root: { [key: string]: FileTreeItem } = {};

	files.forEach((file) => {
		const parts = file.filePath.split('/');
		let currentLevel: { [key: string]: FileTreeItem } = root;

		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!currentLevel[part]) {
				currentLevel[part] = {
					name: part,
					type: 'folder',
					filePath: parts.slice(0, i + 1).join('/'),
					children: {},
				};
			}
			if (!currentLevel[part].children) {
				currentLevel[part].children = {};
			}
			currentLevel = currentLevel[part].children;
		}

		const fileName = parts[parts.length - 1];
		currentLevel[fileName] = {
			name: fileName,
			type: 'file',
			filePath: file.filePath,
			file: file,
		};
	});

	return Object.values(root);
}

const SLOT_LABELS: Record<string, string> = {
	hero: 'Hero',
	work1: 'Work 1',
	work2: 'Work 2',
};

function GeneratedImagesPanel({
	images,
	onDelete,
}: {
	images: Record<string, string>;
	onDelete: (slot: string) => void;
}) {
	const [expanded, setExpanded] = useState(true);
	const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

	const slots = Object.entries(images).filter(([, url]) => url && !url.includes('/undefined/'));
	if (slots.length === 0) return null;

	return (
		<>
			<div className="border-t border-text/10 mt-1">
				<button
					onClick={() => setExpanded(e => !e)}
					className="flex items-center gap-2 py-1 px-3 transition-colors text-sm text-text-primary/50 hover:text-text-primary hover:bg-accent w-full font-medium"
				>
					<ChevronRight className={clsx('size-3 transition-transform duration-200', expanded && 'rotate-90')} />
					<Image className="size-3" />
					Images
					<span className="ml-auto text-[10px] text-text-primary/30">{slots.length}</span>
				</button>

				{expanded && (
					<div className="flex flex-col gap-0.5 pb-1">
						{slots.map(([slot, url]) => (
							<div
								key={slot}
								className="group flex items-center gap-2 px-3 py-1 hover:bg-accent transition-colors"
							>
								<button
									className="flex-shrink-0"
									onClick={() => setLightbox({ url, label: SLOT_LABELS[slot] ?? slot })}
									title="Click to enlarge"
								>
									<img
										src={url}
										alt={slot}
										className="h-7 w-10 rounded object-cover border border-text/10 group-hover:border-text/30 transition-colors"
										crossOrigin="anonymous"
									/>
								</button>
								<span className="flex-1 text-xs text-text-primary/70 truncate">{SLOT_LABELS[slot] ?? slot}</span>
								<button
									onClick={() => onDelete(slot)}
									className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-text-primary/40 hover:text-red-400"
									title="Delete image"
								>
									<Trash2 className="size-3" />
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{lightbox && createPortal(
				<div
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
					onClick={() => setLightbox(null)}
				>
					<div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
						<img
							src={lightbox.url}
							alt={lightbox.label}
							className="max-w-full max-h-[85vh] rounded-lg object-contain shadow-2xl"
							crossOrigin="anonymous"
						/>
						<div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/60 rounded-b-lg px-4 py-2">
							<span className="text-sm text-zinc-300">{lightbox.label}</span>
							<button className="text-xs text-zinc-400 hover:text-white" onClick={() => setLightbox(null)}>Close</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</>
	);
}

export function FileExplorer({
	files,
	currentFile,
	onFileClick,
	generatedImages,
	onDeleteGeneratedImage,
}: {
	files: FileType[];
	currentFile: FileType | undefined;
	onFileClick: (file: FileType) => void;
	generatedImages?: Record<string, string>;
	onDeleteGeneratedImage?: (slot: string) => void;
}) {
	const fileTree = buildFileTree(files);

	return (
		<div className="w-full max-w-[200px] bg-bg-3 border-r border-text/10 h-full overflow-y-auto">
			<div className="p-2 px-3 text-sm flex items-center gap-1 text-text-primary/50 font-medium">
				<LucideNetwork className="size-4" />
				Files
			</div>
			<div className="flex flex-col">
				{fileTree.map((item) => (
					<FileTreeItem
						key={item.filePath}
						item={item}
						currentFile={currentFile}
						onFileClick={onFileClick}
					/>
				))}
			</div>
			{generatedImages && onDeleteGeneratedImage && (
				<GeneratedImagesPanel images={generatedImages} onDelete={onDeleteGeneratedImage} />
			)}
		</div>
	);
}
