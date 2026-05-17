import { useState } from 'react';
import { Github, ArrowRight, ExternalLink, GitBranch, Loader2 } from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api-client';

interface LovableImportModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function LovableImportModal({ open, onOpenChange }: LovableImportModalProps) {
	const [githubUrl, setGithubUrl] = useState('');
	const [branch, setBranch] = useState('main');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const trimmedUrl = githubUrl.trim();
	const isValidUrl =
		/^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(trimmedUrl) ||
		/^[^/\s]+\/[^/\s]+$/.test(trimmedUrl);

	const handleImport = async () => {
		if (!isValidUrl || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const response = await apiClient.initiateGitHubImport({
				repoUrl: trimmedUrl,
				branch: branch.trim() || 'main',
			});
			if (!response.success || !response.data?.authUrl) {
				setError(response.error?.message || 'Could not start the GitHub import.');
				setSubmitting(false);
				return;
			}
			window.location.href = response.data.authUrl;
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unexpected error starting import.');
			setSubmitting(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') handleImport();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px] max-w-[calc(100%-2rem)]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Github className="h-5 w-5 text-accent" />
						Import from GitHub
					</DialogTitle>
					<DialogDescription>
						Bring an existing React + Vite project into RankBuilder. Works with public and private repos —
						we authenticate via GitHub OAuth so you keep full control.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5 mt-1">
					<div className="space-y-3">
						<div className="space-y-1.5">
							<label className="text-sm font-medium text-text-primary">Repository URL</label>
							<div className="relative">
								<Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-primary/40" />
								<Input
									value={githubUrl}
									onChange={e => setGithubUrl(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="https://github.com/your-username/your-project"
									className="pl-9 font-mono text-sm"
									autoFocus
								/>
							</div>
							<p className="text-xs text-text-primary/50">
								Paste the full URL or <code className="text-xs bg-bg-4 px-1 py-0.5 rounded">owner/repo</code> shorthand.
							</p>
						</div>

						<div className="space-y-1.5">
							<label className="text-sm font-medium text-text-primary">Branch</label>
							<div className="relative">
								<GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-primary/40" />
								<Input
									value={branch}
									onChange={e => setBranch(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="main"
									className="pl-9 font-mono text-sm"
								/>
							</div>
							<p className="text-xs text-text-primary/50">
								We'll fall back to the repo's default branch if this one doesn't exist.
							</p>
						</div>
					</div>

					{error && (
						<div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
							{error}
						</div>
					)}

					<div className="flex flex-col gap-3 pt-1">
						<Button
							onClick={handleImport}
							disabled={!isValidUrl || submitting}
							className="bg-accent hover:bg-accent/90 text-white gap-1.5 w-full"
						>
							{submitting ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Redirecting to GitHub…
								</>
							) : (
								<>
									Authorise with GitHub and import <ArrowRight className="h-3.5 w-3.5" />
								</>
							)}
						</Button>
						<p className="text-xs text-text-primary/50 text-center">
							We currently support Vite + React projects only. Other frameworks coming soon.
						</p>
					</div>

					<div className="border-t border-border-primary pt-4">
						<details className="group">
							<summary className="text-sm font-medium text-text-primary cursor-pointer hover:text-accent transition-colors flex items-center gap-1.5">
								Importing from Lovable?
								<span className="text-xs text-text-primary/50 group-open:hidden">Show steps</span>
							</summary>
							<div className="mt-3 ml-1 space-y-1.5 text-sm text-text-primary/70">
								<p>1. In Lovable, click the <strong className="text-text-primary">GitHub</strong> icon in the top toolbar.</p>
								<p>2. Select <strong className="text-text-primary">Connect to GitHub</strong> and authorise.</p>
								<p>3. Click <strong className="text-text-primary">Push to GitHub</strong> — Lovable creates the repo.</p>
								<p>4. Copy the repo URL from GitHub and paste it above.</p>
								<a
									href="https://docs.lovable.dev/tips-tricks/github-integration"
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-2"
								>
									Lovable's GitHub guide <ExternalLink className="h-3 w-3" />
								</a>
							</div>
						</details>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
