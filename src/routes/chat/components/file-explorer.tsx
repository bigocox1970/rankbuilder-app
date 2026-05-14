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

function ImagesTabContent({
	images,
	onDelete,
}: {
	images: Record<string, string>;
	onDelete: (slot: string) => void;
}) {
	const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

	const slots = Object.entries(images).filter(([, url]) => url && !url.includes('/undefined/'));

	if (slots.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center p-4">
				<span className="text-xs text-text-primary/30 text-center">No images generated yet</span>
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col gap-0.5 p-2">
				{slots.map(([slot, url]) => (
					<div
						key={slot}
						className="group flex flex-col gap-1 p-2 rounded hover:bg-bg-4 transition-colors"
					>
						<button
							className="w-full"
							onClick={() => setLightbox({ url, label: SLOT_LABELS[slot] ?? slot })}
							title="Click to enlarge"
						>
							<img
								src={url}
								alt={slot}
								className="w-full h-24 rounded object-cover border border-text/10 group-hover:border-text/30 transition-colors"
								crossOrigin="anonymous"
							/>
						</button>
						<div className="flex items-center justify-between">
							<span className="text-xs text-text-primary/70 truncate">{SLOT_LABELS[slot] ?? slot}</span>
							<button
								onClick={() => onDelete(slot)}
								className="opacity-0 group-hover:opacity-100 transition-opacity text-text-primary/40 hover:text-red-400 flex-shrink-0"
								title="Delete image"
							>
								<Trash2 className="size-3" />
							</button>
						</div>
					</div>
				))}
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
	const [activeTab, setActiveTab] = useState<'files' | 'images'>('files');

	const imageSlots = generatedImages
		? Object.entries(generatedImages).filter(([, url]) => url && !url.includes('/undefined/'))
		: [];
	const hasImages = imageSlots.length > 0;

	const tab = hasImages ? activeTab : 'files';

	return (
		<div className="w-full max-w-[200px] bg-bg-3 border-r border-text/10 h-full overflow-y-auto flex flex-col">
			<div className="flex items-center border-b border-text/10 px-1 pt-1">
				<button
					onClick={() => setActiveTab('files')}
					className={clsx(
						'flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-t transition-colors flex-1 justify-center',
						tab === 'files'
							? 'text-text-primary border-b-2 border-accent -mb-px bg-bg-4'
							: 'text-text-primary/40 hover:text-text-primary/70',
					)}
					title="Files"
				>
					<LucideNetwork className="size-3.5" />
					Files
				</button>
				{hasImages && (
					<button
						onClick={() => setActiveTab('images')}
						className={clsx(
							'flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-t transition-colors flex-1 justify-center',
							tab === 'images'
								? 'text-text-primary border-b-2 border-accent -mb-px bg-bg-4'
								: 'text-text-primary/40 hover:text-text-primary/70',
						)}
						title="Generated Images"
					>
						<Image className="size-3.5" />
						Images
						<span className="text-[9px] text-text-primary/30">{imageSlots.length}</span>
					</button>
				)}
			</div>

			{tab === 'files' ? (
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
			) : (
				<ImagesTabContent
					images={generatedImages!}
					onDelete={onDeleteGeneratedImage!}
				/>
			)}
		</div>
	);
}
