import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { Loader, FileText, FileDown, PanelRight, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { ExportButton } from './export-button';
import { exportMarkdownAsFile } from '@/utils/markdown-export';
import clsx from 'clsx';
import type { FileType } from '@/api-types';
import './markdown-docs-preview.css';

interface MarkdownDocsPreviewProps {
	files: FileType[];
	isGenerating: boolean;
}

export function MarkdownDocsPreview({
	files,
	isGenerating: _isGenerating,
}: MarkdownDocsPreviewProps) {
	// Prioritize README as default, otherwise first file
	const defaultFile = useMemo(() => {
		const readmeFile = files.find((f) =>
			f.filePath.toLowerCase().includes('readme')
		);
		return readmeFile || files[0];
	}, [files]);

	const [activeFilePath, setActiveFilePath] = useState<string>(
		defaultFile?.filePath || ''
	);
	const isMobile = useIsMobile();
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	// Update active file if default changes
	useEffect(() => {
		if (defaultFile && !activeFilePath) {
			setActiveFilePath(defaultFile.filePath);
		}
	}, [defaultFile, activeFilePath]);

	const activeFile = files.find((f) => f.filePath === activeFilePath);

	// Ref for print export
	const contentRef = useRef<HTMLElement>(null);

	// Export handlers
	const handleExportMarkdown = useCallback(() => {
		if (!activeFile) return;
		const filename = activeFile.filePath.split('/').pop() || 'documentation.md';
		exportMarkdownAsFile(activeFile.fileContents || '', filename);
	}, [activeFile]);

	const handlePrint = useCallback(() => {
		window.print();
	}, []);

	// Extract table of contents from markdown headings
	const tableOfContents = useMemo(() => {
		if (!activeFile?.fileContents) return [];

		const headingRegex = /^(#{1,3})\s+(.+)$/gm;
		const headings: { level: number; text: string; id: string }[] = [];
		let match;

		while ((match = headingRegex.exec(activeFile.fileContents)) !== null) {
			const level = match[1].length;
			const text = match[2];
			const id = text
				.toLowerCase()
				.replace(/[^\w\s-]/g, '')
				.replace(/\s+/g, '-');

			headings.push({ level, text, id });
		}

		return headings;
	}, [activeFile?.fileContents]);

	const handleFileSelect = (filePath: string) => {
		setActiveFilePath(filePath);
		setMobileNavOpen(false);
	};

	const markdownContent = useMemo(() => {
		if (!activeFile) return '';

		let content = activeFile.fileContents || '';

		// Add generating indicator if still streaming
		if (activeFile.isGenerating && content) {
			content += '\n\n_Generating..._';
		}

		return content;
	}, [activeFile]);

	const showRightPanel = tableOfContents.length > 0 || files.length > 1;

	return (
		<div className="flex-1 flex flex-col overflow-hidden min-w-0">
			{/* Header */}
			<div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 h-12 bg-bg-2 border-b border-border-primary min-w-0">
				{/* Left: File name and status */}
				<div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
					<span className="text-sm font-medium text-text-primary truncate">
						{activeFile?.filePath || 'Documentation'}
					</span>
					{activeFile?.isGenerating && (
						<div className="flex items-center gap-2 text-xs text-accent flex-shrink-0">
							<Loader className="size-3 animate-spin" />
							<span className="hidden sm:inline">Generating...</span>
						</div>
					)}
				</div>

				{/* Right: Export buttons + mobile nav toggle */}
				<div className="flex items-center gap-2 export-button-container flex-shrink-0">
					<ExportButton
						icon={FileText}
						onClick={handleExportMarkdown}
						tooltip="Download Markdown"
						disabled={!activeFile}
					/>
					<ExportButton
						icon={FileDown}
						onClick={handlePrint}
						tooltip="Print to PDF"
						disabled={!activeFile}
					/>
					{isMobile && showRightPanel && (
						<button
							onClick={() => setMobileNavOpen(true)}
							className="p-1.5 rounded text-text-primary/60 hover:text-text-primary hover:bg-bg-3 transition-colors"
							aria-label="Open documents and table of contents"
						>
							<PanelRight className="size-4" />
						</button>
					)}
				</div>
			</div>

			{/* Content with right panel */}
			<div className="flex-1 flex overflow-hidden min-w-0 relative">
				{/* Main markdown content */}
				<div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
					{!activeFile ? (
						<div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
							<p>No documentation file selected</p>
						</div>
					) : !markdownContent ? (
						<div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
							<Loader className="size-8 animate-spin text-accent" />
							<p>Waiting for content...</p>
						</div>
					) : (
						<article ref={contentRef} className="prose prose-sm prose-invert max-w-none break-words prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-words prose-table:block prose-table:overflow-x-auto">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[[rehypeExternalLinks, { target: '_blank' }]]}
								components={{
									h1: ({ node, ...props }) => (
										<h1 id={createId(props.children)} {...props} />
									),
									h2: ({ node, ...props }) => (
										<h2 id={createId(props.children)} {...props} />
									),
									h3: ({ node, ...props }) => (
										<h3 id={createId(props.children)} {...props} />
									),
								}}
							>
								{markdownContent}
							</ReactMarkdown>
						</article>
					)}
				</div>

				{/* Right panel: file list (if multiple) + TOC.
				    Desktop: inline sidebar. Mobile: slide-in drawer + backdrop. */}
				{showRightPanel && !isMobile && (
					<div className="w-56 border-l border-border-primary bg-bg-2 overflow-y-auto py-6 px-4 flex flex-col gap-6 flex-shrink-0">
						<RightPanelContent
							files={files}
							activeFilePath={activeFilePath}
							tableOfContents={tableOfContents}
							onFileSelect={handleFileSelect}
						/>
					</div>
				)}

				{showRightPanel && isMobile && mobileNavOpen && (
					<>
						<button
							onClick={() => setMobileNavOpen(false)}
							className="absolute inset-0 bg-black/40 z-10"
							aria-label="Close panel"
						/>
						<div className="absolute top-0 right-0 bottom-0 w-64 max-w-[80%] z-20 border-l border-border-primary bg-bg-2 overflow-y-auto py-4 px-4 flex flex-col gap-6 shadow-xl">
							<button
								onClick={() => setMobileNavOpen(false)}
								className="self-end p-1 rounded text-text-primary/60 hover:text-text-primary"
								aria-label="Close"
							>
								<X className="size-4" />
							</button>
							<RightPanelContent
								files={files}
								activeFilePath={activeFilePath}
								tableOfContents={tableOfContents}
								onFileSelect={handleFileSelect}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function RightPanelContent({
	files,
	activeFilePath,
	tableOfContents,
	onFileSelect,
}: {
	files: FileType[];
	activeFilePath: string;
	tableOfContents: { level: number; text: string; id: string }[];
	onFileSelect: (filePath: string) => void;
}) {
	return (
		<>
			{/* Document selector — only shown when more than one file */}
			{files.length > 1 && (
				<div>
					<h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
						Documents
					</h4>
					<ul className="space-y-1">
						{files.map((file) => {
							const name = file.filePath.split('/').pop() || file.filePath;
							const isActive = file.filePath === activeFilePath;
							return (
								<li key={file.filePath}>
									<button
										onClick={() => onFileSelect(file.filePath)}
										className={clsx(
											'w-full text-left text-xs px-2 py-1.5 rounded transition-colors flex items-center gap-2',
											isActive
												? 'bg-accent/10 text-accent'
												: 'text-text-tertiary hover:text-text-primary hover:bg-bg-3'
										)}
									>
										<FileText className="size-3 flex-shrink-0" />
										<span className="truncate">{name}</span>
										{file.isGenerating && (
											<Loader className="size-3 animate-spin flex-shrink-0 ml-auto" />
										)}
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{/* Table of contents */}
			{tableOfContents.length > 0 && (
				<div>
					<h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
						On This Page
					</h4>
					<nav>
						<ul className="space-y-2">
							{tableOfContents.map((heading, idx) => (
								<li
									key={idx}
									style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
								>
									<a
										href={`#${heading.id}`}
										className="text-xs text-text-tertiary hover:text-text-primary transition-colors block break-words"
									>
										{heading.text}
									</a>
								</li>
							))}
						</ul>
					</nav>
				</div>
			)}
		</>
	);
}

/**
 * Create ID from heading text for anchor links
 */
function createId(children: ReactNode): string {
	const text = extractText(children);
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-');
}

/**
 * Extract text from React children
 */
function extractText(children: ReactNode): string {
	if (typeof children === 'string') return children;
	if (Array.isArray(children)) return children.map(extractText).join('');
	if (children && typeof children === 'object' && 'props' in children) {
		const element = children as { props: { children?: ReactNode } };
		return extractText(element.props.children);
	}
	return '';
}
