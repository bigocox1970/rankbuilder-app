import { type RefObject, type ReactNode, Suspense, useState, useCallback, useEffect } from 'react';
import type { ViewportMode } from '@/features/core/types';
import { WebSocket } from 'partysocket';
import { MonacoEditor } from '../../../components/monaco-editor/monaco-editor';
import { motion } from 'framer-motion';
import { RefreshCw, ChevronLeft, MousePointer2, PenLine } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Blueprint } from './blueprint';
import { FileExplorer } from './file-explorer';
import { PreviewIframe } from './preview-iframe';
import { MarkdownDocsPreview } from './markdown-docs-preview';
import { SeoPanel } from './seo-panel';
import { SocialPreviewPanel } from './social-preview-panel';
import { LlmsPanel } from './llms-panel';
import { ViewContainer } from './view-container';
import { ViewHeader } from './view-header';
import { PreviewHeaderActions } from './preview-header-actions';
import { EditorHeaderActions } from './editor-header-actions';
import { featureRegistry } from '@/features';
import type { FileType, BlueprintType, BehaviorType, ModelConfigsInfo, TemplateDetails, ProjectType } from '@/api-types';
import type { ContentDetectionResult } from '../utils/content-detector';
import type { GitHubExportHook } from '@/hooks/use-github-export';
import type { Edit } from '../hooks/use-chat';

interface MainContentPanelProps {
	// View state
	view: 'editor' | 'preview' | 'docs' | 'blueprint' | 'terminal' | 'presentation' | 'seo' | 'social' | 'llms';
	onViewChange: (mode: 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'seo' | 'social' | 'llms') => void;

	// Content detection
	hasDocumentation: boolean;
	hasSeoData: boolean;
	hasLlmsTxt: boolean;
	contentDetection: ContentDetectionResult;

	// Preview state
	projectType: ProjectType;
	previewUrl?: string;
	previewAvailable: boolean;
	showTooltip: boolean;
	shouldRefreshPreview: boolean;
	manualRefreshTrigger: number;
	onManualRefresh: () => void;

	// Blueprint
	blueprint?: BlueprintType | null;

	// Editor state
	activeFile?: FileType;
	allFiles: FileType[];
	edit?: Edit | null;
	onFileClick: (file: FileType) => void;

	// Generation state
	isGenerating: boolean;
	isGeneratingBlueprint: boolean;

	// Model configs
	modelConfigs?: ModelConfigsInfo;
	loadingConfigs: boolean;
	onRequestConfigs: () => void;

	// Git/GitHub actions
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	githubExport: GitHubExportHook;

	// Template metadata
	templateDetails?: TemplateDetails | null;

	// Other
	behaviorType?: BehaviorType;
	websocket?: WebSocket;

	// Refs
	previewRef: RefObject<HTMLIFrameElement | null>;
	editorRef: RefObject<HTMLDivElement | null>;

	// Generated images
	generatedImages?: Record<string, string>;
	onDeleteGeneratedImage?: (slot: string) => void;

	// Panel actions
	onSendMessage?: (msg: string) => void;
	onPrefillMessage?: (msg: string) => void;
}

export function MainContentPanel(props: MainContentPanelProps) {
	const {
		view,
		onViewChange,
		hasDocumentation,
		hasSeoData,
		hasLlmsTxt,
		contentDetection,
		projectType,
		previewUrl,
		previewAvailable,
		showTooltip,
		shouldRefreshPreview,
		manualRefreshTrigger,
		onManualRefresh,
		blueprint,
		activeFile,
		allFiles,
		edit,
		onFileClick,
		isGenerating,
		isGeneratingBlueprint,
		modelConfigs,
		loadingConfigs,
		onRequestConfigs,
		onGitCloneClick,
		isGitHubExportReady,
		githubExport,
		behaviorType,
		websocket,
		previewRef,
		editorRef,
		templateDetails,
		generatedImages,
		onDeleteGeneratedImage,
		onSendMessage,
		onPrefillMessage,
	} = props;

	const isMobile = useIsMobile();
	const [mobileShowEditor, setMobileShowEditor] = useState(false);
	const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');

	// When switching away from editor, reset mobile view to file list
	useEffect(() => {
		if (view !== 'editor') setMobileShowEditor(false);
	}, [view]);

	// Reset viewport to desktop when leaving preview
	useEffect(() => {
		if (view !== 'preview') setViewportMode('desktop');
	}, [view]);

	// Element selector state — only active for browser-mode (HTML) templates
	type SelectorMode = 'off' | 'select' | 'edit';
	const [selectorMode, setSelectorMode] = useState<SelectorMode>('off');

	// Disable selector when leaving preview
	useEffect(() => {
		if (view !== 'preview') setSelectorMode('off');
	}, [view]);

	// Send selector enable/disable to iframe via postMessage
	useEffect(() => {
		const iframe = previewRef.current;
		if (!iframe?.contentWindow || !previewUrl) return;
		let origin = '*';
		try { origin = new URL(previewUrl).origin; } catch { /* use wildcard */ }
		iframe.contentWindow.postMessage(
			selectorMode !== 'off'
				? { type: 'RB_ENABLE_SELECTOR', mode: selectorMode }
				: { type: 'RB_DISABLE_SELECTOR' },
			origin
		);
	}, [selectorMode, previewUrl, previewRef]);

	// Listen for element click/edit messages from iframe
	useEffect(() => {
		const handler = (e: MessageEvent) => {
			if (!e.data) return;
			if (e.data.type === 'RB_ELEMENT_CLICK') {
				const { tag, text } = e.data as { tag: string; text: string };
				const label = text ? `"${text.slice(0, 60)}"` : 'element';
				onPrefillMessage?.(`The ${tag} ${label} — `);
			}
			if (e.data.type === 'RB_ELEMENT_EDIT') {
				const { tag, oldText, newText } = e.data as { tag: string; oldText: string; newText: string };
				onSendMessage?.(`Change the ${tag} "${oldText}" to "${newText}"`);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [onPrefillMessage, onSendMessage]);

	const isBrowserTemplate = templateDetails?.renderMode === 'browser';

	// On mobile, clicking a file switches to editor view
	const handleFileClickWrapped = useCallback((file: FileType) => {
		onFileClick(file);
		if (isMobile) setMobileShowEditor(true);
	}, [onFileClick, isMobile]);

	// Feature-specific state management
	const [featureState, setFeatureStateInternal] = useState<Record<string, unknown>>({});
	const setFeatureState = useCallback((key: string, value: unknown) => {
		setFeatureStateInternal(prev => ({ ...prev, [key]: value }));
	}, []);

	const commonHeaderProps = {
		view: view as 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'seo' | 'social' | 'llms',
		onViewChange,
		previewAvailable,
		showTooltip,
		hasDocumentation,
		hasSeoData,
		hasLlmsTxt,
		previewUrl,
		projectType,
	};

	const renderViewWithHeader = (
		viewContent: ReactNode,
		rightActions?: ReactNode,
		headerOverrides?: Partial<typeof commonHeaderProps>
	) => (
		<ViewContainer>
			<ViewHeader
				{...commonHeaderProps}
				{...headerOverrides}
				rightActions={rightActions}
			/>
			{viewContent}
		</ViewContainer>
	);

	const renderDocsView = () => {
		if (!hasDocumentation) return null;

		const markdownFiles = Object.values(contentDetection.Contents)
			.filter(bundle => bundle.type === 'markdown')
			.flatMap(bundle => bundle.files);

		if (markdownFiles.length === 0) return null;

		return renderViewWithHeader(
			<MarkdownDocsPreview
				files={markdownFiles}
				isGenerating={isGenerating || isGeneratingBlueprint}
			/>
		);
	};

	const renderPreviewView = () => {
		if (!previewUrl) {
			return null;
		}

		// Get lazy-loaded preview component from feature registry
		const FeaturePreviewComponent = featureRegistry.getLazyPreviewComponent(projectType);

		// Fallback to default PreviewIframe if no feature-specific component
		const previewContent = FeaturePreviewComponent ? (
			<Suspense
				fallback={
					<div className="flex-1 w-full h-full flex items-center justify-center bg-bg-3">
						<RefreshCw className="size-6 text-accent animate-spin" />
					</div>
				}
			>
				<FeaturePreviewComponent
					projectType={projectType}
					behaviorType={behaviorType ?? 'phasic'}
					previewUrl={previewUrl}
					websocket={websocket}
					files={allFiles}
					activeFile={activeFile}
					currentView={view}
					onViewChange={(v) => onViewChange(v as 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation')}
					templateDetails={templateDetails}
					modelConfigs={modelConfigs}
					blueprint={blueprint}
					previewRef={previewRef}
					editorRef={editorRef}
					shouldRefreshPreview={shouldRefreshPreview}
					manualRefreshTrigger={manualRefreshTrigger}
					onManualRefresh={onManualRefresh}
					featureState={featureState}
					setFeatureState={setFeatureState}
					className="flex-1 w-full h-full border-0"
				/>
			</Suspense>
		) : (
			<PreviewIframe
				src={previewUrl}
				ref={previewRef}
				className="flex-1 w-full h-full border-0"
				title="Preview"
				shouldRefreshPreview={shouldRefreshPreview}
				manualRefreshTrigger={manualRefreshTrigger}
				webSocket={websocket}
			/>
		);

		// Wrap content in viewport stage when not in desktop mode
		const viewportContent = viewportMode === 'desktop' ? previewContent : (
			<div className="flex-1 flex justify-center bg-bg-2 overflow-hidden">
				<div
					className="flex flex-col overflow-hidden border-x border-border-primary shadow-inner"
					style={{ width: viewportMode === 'tablet' ? '768px' : '390px' }}
				>
					{previewContent}
				</div>
			</div>
		);

		// Get lazy-loaded header actions component from feature registry
		const FeatureHeaderActionsComponent = featureRegistry.getLazyHeaderActionsComponent(projectType);

		// Fallback to PreviewHeaderActions if no feature-specific component
		const headerActions = FeatureHeaderActionsComponent ? (
			<Suspense fallback={null}>
				<FeatureHeaderActionsComponent
					projectType={projectType}
					behaviorType={behaviorType ?? 'phasic'}
					previewUrl={previewUrl}
					websocket={websocket}
					files={allFiles}
					activeFile={activeFile}
					currentView={view}
					onViewChange={(v) => onViewChange(v as 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation')}
					templateDetails={templateDetails}
					modelConfigs={modelConfigs}
					blueprint={blueprint}
					previewRef={previewRef}
					editorRef={editorRef}
					shouldRefreshPreview={shouldRefreshPreview}
					manualRefreshTrigger={manualRefreshTrigger}
					onManualRefresh={onManualRefresh}
					featureState={featureState}
					setFeatureState={setFeatureState}
					onGitCloneClick={onGitCloneClick}
					isGitHubExportReady={isGitHubExportReady}
					onGitHubExportClick={githubExport.openModal}
					loadingConfigs={loadingConfigs}
					onRequestConfigs={onRequestConfigs}
					viewportMode={viewportMode}
					onViewportChange={setViewportMode}
				/>
			</Suspense>
		) : (
			<PreviewHeaderActions
				onGitCloneClick={onGitCloneClick}
				isGitHubExportReady={isGitHubExportReady}
				onGitHubExportClick={githubExport.openModal}
				previewRef={previewRef}
				previewUrl={previewUrl}
				onManualRefresh={onManualRefresh}
				viewportMode={viewportMode}
				onViewportChange={setViewportMode}
			/>
		);

		const selectorButtons = isBrowserTemplate ? (
			<div className="flex items-center border border-border-primary rounded-md overflow-hidden mr-1">
				<button
					onClick={() => setSelectorMode(selectorMode === 'select' ? 'off' : 'select')}
					className={`p-1.5 transition-colors ${selectorMode === 'select' ? 'bg-accent text-white' : 'text-text-primary/50 hover:text-text-primary hover:bg-bg-3'}`}
					title="Click element to reference in chat"
				>
					<MousePointer2 className="size-3.5" />
				</button>
				<button
					onClick={() => setSelectorMode(selectorMode === 'edit' ? 'off' : 'edit')}
					className={`p-1.5 transition-colors ${selectorMode === 'edit' ? 'bg-accent text-white' : 'text-text-primary/50 hover:text-text-primary hover:bg-bg-3'}`}
					title="Click text to edit inline"
				>
					<PenLine className="size-3.5" />
				</button>
			</div>
		) : null;

		return renderViewWithHeader(
			viewportContent,
			<div className="flex items-center">
				{selectorButtons}
				{headerActions}
			</div>
		);
	};

	const renderBlueprintView = () =>
		renderViewWithHeader(
			<div className="flex-1 overflow-y-auto bg-bg-3">
				<div className="py-12 mx-auto">
					<Blueprint
						blueprint={blueprint ?? ({} as BlueprintType)}
						className="w-full max-w-2xl mx-auto"
					/>
				</div>
			</div>
		);

	const renderEditorView = () => {
		// Mobile: show file list OR editor, not both side-by-side
		if (isMobile) {
			if (!activeFile || !mobileShowEditor) {
				return renderViewWithHeader(
					<div className="flex-1 overflow-y-auto bg-bg-3">
						<FileExplorer
							files={allFiles}
							currentFile={activeFile}
							onFileClick={handleFileClickWrapped}
							generatedImages={generatedImages}
							onDeleteGeneratedImage={onDeleteGeneratedImage}
						/>
					</div>
				);
			}
			return renderViewWithHeader(
				<div className="flex-1 relative">
					<div className="absolute inset-0" ref={editorRef}>
						<MonacoEditor
							className="h-full"
							createOptions={{
								value: activeFile.fileContents || '',
								language: activeFile.language || 'plaintext',
								readOnly: true,
								minimap: { enabled: false },
								lineNumbers: 'on',
								scrollBeyondLastLine: false,
								fontSize: 12,
								theme: 'vibesdk',
								automaticLayout: true,
							}}
							find={edit?.filePath === activeFile.filePath ? edit.search : undefined}
							replace={edit?.filePath === activeFile.filePath ? edit.replacement : undefined}
						/>
					</div>
				</div>,
				<button
					onClick={() => setMobileShowEditor(false)}
					className="flex items-center gap-1 text-xs text-text-primary/60 hover:text-accent transition-colors px-1"
				>
					<ChevronLeft className="size-3.5" />
					Files
				</button>
			);
		}

		// Desktop: file explorer sidebar + code editor side-by-side
		if (!activeFile) {
			return renderViewWithHeader(
				<div className="flex-1 relative">
					<div className="absolute inset-0 flex" ref={editorRef}>
						<FileExplorer
							files={allFiles}
							currentFile={undefined}
							onFileClick={onFileClick}
							generatedImages={generatedImages}
							onDeleteGeneratedImage={onDeleteGeneratedImage}
						/>
						<div className="flex-1 flex items-center justify-center bg-bg-3">
							<span className="text-text-50/50 text-sm">No file selected</span>
						</div>
					</div>
				</div>,
				<EditorHeaderActions
					modelConfigs={modelConfigs}
					onRequestConfigs={onRequestConfigs}
					loadingConfigs={loadingConfigs}
					onGitCloneClick={onGitCloneClick}
					isGitHubExportReady={isGitHubExportReady}
					onGitHubExportClick={githubExport.openModal}
					editorRef={editorRef}
					allFiles={allFiles}
					generatedImages={generatedImages}
				/>
			);
		}

		return renderViewWithHeader(
			<div className="flex-1 relative">
				<div className="absolute inset-0 flex" ref={editorRef}>
					<FileExplorer
						files={allFiles}
						currentFile={activeFile}
						onFileClick={onFileClick}
						generatedImages={generatedImages}
						onDeleteGeneratedImage={onDeleteGeneratedImage}
					/>
					<div className="flex-1">
						<MonacoEditor
							className="h-full"
							createOptions={{
								value: activeFile.fileContents || '',
								language: activeFile.language || 'plaintext',
								readOnly: true,
								minimap: { enabled: false },
								lineNumbers: 'on',
								scrollBeyondLastLine: false,
								fontSize: 13,
								theme: 'vibesdk',
								automaticLayout: true,
							}}
							find={edit?.filePath === activeFile.filePath ? edit.search : undefined}
							replace={edit?.filePath === activeFile.filePath ? edit.replacement : undefined}
						/>
					</div>
				</div>
			</div>,
			<EditorHeaderActions
				modelConfigs={modelConfigs}
				onRequestConfigs={onRequestConfigs}
				loadingConfigs={loadingConfigs}
				onGitCloneClick={onGitCloneClick}
				isGitHubExportReady={isGitHubExportReady}
				onGitHubExportClick={githubExport.openModal}
				editorRef={editorRef}
				allFiles={allFiles}
				generatedImages={generatedImages}
			/>
		);
	};

	const renderSeoView = () => {
		const seoFile = allFiles.find(f => f.filePath === 'seo.json');
		const htmlFile = allFiles.find(f => f.filePath === 'index.html' || f.filePath === 'public/index.html');
		return renderViewWithHeader(
			<SeoPanel seoFile={seoFile} htmlFile={htmlFile} isGenerating={isGenerating} onSendMessage={onSendMessage ?? (() => {})} />
		);
	};

	const renderSocialView = () => {
		const seoFile = allFiles.find(f => f.filePath === 'seo.json');
		const htmlFile = allFiles.find(f => f.filePath === 'index.html' || f.filePath === 'public/index.html');
		const faviconFile = allFiles.find(f =>
			f.filePath === 'favicon.svg' ||
			f.filePath === 'public/favicon.svg' ||
			f.filePath.endsWith('/favicon.svg')
		);
		return renderViewWithHeader(
			<SocialPreviewPanel seoFile={seoFile} htmlFile={htmlFile} faviconFile={faviconFile} onSendMessage={onSendMessage} />
		);
	};

	const renderLlmsView = () => {
		const llmsFile = allFiles.find(f => f.filePath === 'llms.txt');
		const seoFile = allFiles.find(f => f.filePath === 'seo.json');
		return renderViewWithHeader(
			<LlmsPanel llmsFile={llmsFile} seoFile={seoFile} onSendMessage={onSendMessage ?? (() => {})} />
		);
	};

	const renderView = () => {
		switch (view) {
			case 'docs':
				return renderDocsView();
			case 'preview':
			case 'presentation': // Presentations now use preview view
				return renderPreviewView();
			case 'blueprint':
				return renderBlueprintView();
			case 'editor':
				return renderEditorView();
			case 'seo':
				return renderSeoView();
			case 'social':
				return renderSocialView();
			case 'llms':
				return renderLlmsView();
			default:
				return null;
		}
	};

	return (
		<motion.div
			className="flex-1 flex flex-col overflow-hidden"
			initial={{ opacity: 0, scale: 0.84 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.3, ease: 'easeInOut' }}
		>
			{renderView()}
		</motion.div>
	);
}
