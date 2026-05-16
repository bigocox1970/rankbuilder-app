import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Zap, Github, ArrowRight, ExternalLink } from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface LovableImportModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function LovableImportModal({ open, onOpenChange }: LovableImportModalProps) {
	const navigate = useNavigate();
	const [githubUrl, setGithubUrl] = useState('');

	const isValidUrl = githubUrl.trim().startsWith('https://github.com/') && githubUrl.trim().length > 25;

	const handleImport = () => {
		if (!isValidUrl) return;
		const url = githubUrl.trim().replace(/\/$/, '');
		onOpenChange(false);
		navigate(`/?import=${encodeURIComponent(url)}`);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') handleImport();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px] max-w-[calc(100%-2rem)]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="h-5 w-5 text-accent" />
						Import from Lovable
					</DialogTitle>
					<DialogDescription>
						Bring your Lovable project to RankBuilder — we'll make it SEO-friendly and deploy it to Cloudflare.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5 mt-1">
					{/* Step 1 */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-xs font-bold flex-shrink-0">1</span>
							<span className="text-sm font-medium text-text-primary">Push your Lovable project to GitHub</span>
						</div>
						<ol className="ml-7 space-y-1.5 text-sm text-text-primary/70 list-none">
							<li className="flex items-start gap-2">
								<span className="text-accent mt-0.5">→</span>
								<span>In Lovable, click the <strong className="text-text-primary">GitHub</strong> icon in the top toolbar</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-accent mt-0.5">→</span>
								<span>Select <strong className="text-text-primary">Connect to GitHub</strong> and authorise if prompted</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-accent mt-0.5">→</span>
								<span>Click <strong className="text-text-primary">Push to GitHub</strong> — Lovable will create or update your repository</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-accent mt-0.5">→</span>
								<span>Copy the repository URL from GitHub (e.g. <code className="text-xs bg-bg-4 px-1 py-0.5 rounded">github.com/you/your-project</code>)</span>
							</li>
						</ol>
						<a
							href="https://docs.lovable.dev/tips-tricks/github-integration"
							target="_blank"
							rel="noopener noreferrer"
							className="ml-7 inline-flex items-center gap-1 text-xs text-accent hover:underline"
						>
							Lovable GitHub guide <ExternalLink className="h-3 w-3" />
						</a>
					</div>

					<div className="border-t border-border-primary" />

					{/* Step 2 */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-xs font-bold flex-shrink-0">2</span>
							<span className="text-sm font-medium text-text-primary">Paste your GitHub URL and import</span>
						</div>
						<div className="ml-7 space-y-3">
							<div className="flex gap-2">
								<div className="relative flex-1">
									<Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-primary/40" />
									<Input
										value={githubUrl}
										onChange={e => setGithubUrl(e.target.value)}
										onKeyDown={handleKeyDown}
										placeholder="https://github.com/your-username/your-project"
										className="pl-9 font-mono text-sm"
									/>
								</div>
								<Button
									onClick={handleImport}
									disabled={!isValidUrl}
									className="bg-accent hover:bg-accent/90 text-white gap-1.5 flex-shrink-0"
								>
									Import <ArrowRight className="h-3.5 w-3.5" />
								</Button>
							</div>
							<p className="text-xs text-text-primary/50">
								We'll clone your project, add SEO optimisation, structured data, and deploy it to Cloudflare — making it Google-friendly out of the box.
							</p>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
