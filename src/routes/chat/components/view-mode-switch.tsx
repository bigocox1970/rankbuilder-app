import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, Code, FileText, Presentation, Share2, Bot } from 'lucide-react';
import { featureRegistry } from '@/features';
import type { ProjectType } from '@/api-types';

function GoogleIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
			<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
		</svg>
	);
}

// Map icon names to components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
	Eye,
	Presentation,
};

export function ViewModeSwitch({
	view,
	onChange,
	previewAvailable = false,
	showTooltip = false,
	hasDocumentation = false,
	hasSeoData = false,
	hasLlmsTxt = false,
	previewUrl,
	projectType,
}: {
	view: 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'seo' | 'social' | 'llms'
	onChange: (mode: 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'seo' | 'social' | 'llms') => void;
	previewAvailable: boolean;
	showTooltip: boolean;
	hasDocumentation: boolean;
	hasSeoData: boolean;
	hasLlmsTxt: boolean;
	previewUrl?: string;
	projectType?: ProjectType;
}) {
	// Get feature definition to determine icon and label
	const featureDefinition = projectType ? featureRegistry.getDefinition(projectType) : null;

	// Get the preview view definition to find the icon
	const featureModule = projectType ? featureRegistry.getModule(projectType) : null;
	const views = featureModule?.getViews() ?? [];
	const previewView = views.find(v => v.id === 'preview');
	const iconName = previewView?.iconName;
	const PreviewIcon = (iconName && ICON_MAP[iconName]) || Eye;

	if (!previewAvailable) {
		return null;
	}

	return (
		<div className="flex items-center gap-1 bg-bg-1 rounded-md p-0.5 relative">
			<AnimatePresence>
				{showTooltip && (
					<motion.div
						initial={{ opacity: 0, scale: 0.4 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0 }}
						className="absolute z-50 top-10 left-0 bg-bg-2 text-text-primary text-xs px-2 py-1 rounded whitespace-nowrap animate-fade-in"
					>
						You can view code anytime from here
					</motion.div>
				)}
			</AnimatePresence>

			{/* Preview button - show when app has preview URL */}
			{previewUrl && (
				<button
					onClick={() => onChange('preview')}
					className={clsx(
						'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
						view === 'preview' || view === 'presentation'
							? 'bg-bg-4 text-accent'
							: 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60',
					)}
					title={featureDefinition?.name ?? 'Preview'}
				>
					<PreviewIcon className="size-4" />
				</button>
			)}

			<button
				onClick={() => onChange('editor')}
				className={clsx(
					'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
					view === 'editor'
						? 'bg-bg-4 text-accent'
						: 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60',
				)}
				title="Code"
			>
				<Code className="size-4" />
			</button>

			{/* Docs button - show when documentation exists */}
			{hasDocumentation && (
				<button
					onClick={() => onChange('docs')}
					className={clsx(
						'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
						view === 'docs'
							? 'bg-bg-4 text-accent'
							: 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60',
					)}
					title="Docs"
				>
					<FileText className="size-4" />
				</button>
			)}

			{/* SEO tab — always shown when there's a live preview */}
			{previewAvailable && (
				<button
					onClick={() => onChange('seo')}
					className={clsx(
						'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
						view === 'seo'
							? 'bg-bg-4 text-accent'
							: hasSeoData
								? 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60'
								: 'text-text-primary/20 hover:text-accent hover:bg-bg-4/60',
					)}
					title="SEO"
				>
					<GoogleIcon className="size-4" />
				</button>
			)}

			{/* Social sharing tab — always shown when there's a live preview */}
			{previewAvailable && (
				<button
					onClick={() => onChange('social')}
					className={clsx(
						'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
						view === 'social'
							? 'bg-bg-4 text-accent'
							: hasSeoData
								? 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60'
								: 'text-text-primary/20 hover:text-accent hover:bg-bg-4/60',
					)}
					title="Social sharing"
				>
					<Share2 className="size-4" />
				</button>
			)}

			{/* LLMs.txt tab — always shown when there's a live preview */}
			{previewAvailable && (
				<button
					onClick={() => onChange('llms')}
					className={clsx(
						'p-1.5 flex items-center justify-center rounded-md transition-all duration-200',
						view === 'llms'
							? 'bg-bg-4 text-accent'
							: hasLlmsTxt
								? 'text-text-primary/40 hover:text-accent hover:bg-bg-4/60'
								: 'text-text-primary/20 hover:text-accent hover:bg-bg-4/60',
					)}
					title="LLMs.txt — AI discoverability"
				>
					<Bot className="size-4" />
				</button>
			)}

			{/* {terminalAvailable && (
				<button
					onClick={() => onChange('terminal')}
					className={clsx(
						'p-1 flex items-center justify-between h-full rounded-md transition-colors',
						view === 'terminal'
							? 'bg-bg-4 text-text-primary'
							: 'text-text-50/70 hover:text-text-primary hover:bg-accent',
					)}
					title="Terminal"
				>
					<Terminal className="size-4" />
				</button>
			)} */}
		</div>
	);
}
