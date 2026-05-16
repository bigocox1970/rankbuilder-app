import { useEffect, useState } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { AuthButton } from '../auth/auth-button';
import { ThemeToggle } from '../theme-toggle';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { ChevronRight, AlertCircle, Zap } from 'lucide-react';
import { usePlatformStatus } from '@/hooks/use-platform-status';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UsageLimitsBadge } from '../usage-limits-badge';
import { LovableImportModal } from '../lovable-import-modal';

export function GlobalHeader() {
	const { user } = useAuth();
	const { status } = usePlatformStatus();
	const [isChangelogOpen, setIsChangelogOpen] = useState(false);
	const [isLovableOpen, setIsLovableOpen] = useState(false);
	const hasMaintenanceMessage = Boolean(status.hasActiveMessage && status.globalUserMessage.trim().length > 0);
	const hasChangeLogs = Boolean(status.changeLogs && status.changeLogs.trim().length > 0);
	useEffect(() => {
		if (!hasChangeLogs) {
			setIsChangelogOpen(false);
		}
	}, [hasChangeLogs]);

	return (
		<>
		<LovableImportModal open={isLovableOpen} onOpenChange={setIsLovableOpen} />
		<Dialog open={isChangelogOpen} onOpenChange={setIsChangelogOpen}>
			<motion.header
				initial={{ y: -10, opacity: 0 }}
				animate={{ y: 0, opacity: 1 }}
				transition={{ duration: 0.2, ease: 'easeOut' }}
				className="sticky top-0 z-[60] bg-bg-3/80 backdrop-blur-md border-b border-border/20"
			>
				<div className="relative">
					{/* Subtle gradient accent */}
					<div className="absolute inset-0 z-0" />

					{/* Main content */}
					<div className="relative z-10 grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-2">
						{/* Left section */}
						<motion.div
							whileTap={{ scale: 0.95 }}
							transition={{ type: 'spring', stiffness: 400, damping: 17 }}
							className="flex items-center"
						>
							{user && (
								<SidebarTrigger className="h-8 w-8 text-text-primary rounded-md hover:bg-accent/10 transition-colors duration-200" />
							)}
							<a
								href="https://rankbuilder.app"
								className="flex items-center no-underline"
								style={{ marginLeft: user ? '8px' : '0' }}
							>
								<img
									src="/favicon-96x96.png"
									alt="RankBuilder"
									className="flex-shrink-0 transition-all duration-300"
									style={{ width: '32px', height: '32px' }}
								/>
								<span className="ml-2 font-bold text-lg tracking-tight text-text-primary">
									Rank<span style={{ color: '#00E676' }}>Builder</span>
								</span>
							</a>
							{hasMaintenanceMessage && (
								<button
									type="button"
									onClick={hasChangeLogs ? () => setIsChangelogOpen(true) : undefined}
									disabled={!hasChangeLogs}
									className={`flex max-w-full items-center gap-2 rounded-full border border-accent/40 bg-bg-4/80 px-3 ml-4 py-1.5 text-xs text-text-primary shadow-sm backdrop-blur transition-colors hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/40 dark:border-accent/30 dark:bg-bg-2/80 md:text-sm${!hasChangeLogs ? ' opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
									aria-label="Platform updates"
								>
									<AlertCircle className="h-4 w-4 text-accent" />
									<span className="truncate max-w-[46ch] md:max-w-[60ch]">{status.globalUserMessage}</span>
									<ChevronRight className="ml-1 h-4 w-4 text-accent" />
								</button>
							)}
						</motion.div>



						{/* Right section */}
						<motion.div
							initial={{ opacity: 0, x: 10 }}
							animate={{ opacity: 1, x: 0 }}
							transition={{ delay: 0.2 }}
							className="flex flex-wrap items-center justify-end gap-3 justify-self-end"
						>
							{/* Disable cost display for now */}
							{/* {user && (
							<CostDisplay
								{...extractUserAnalyticsProps(analytics)}
								loading={analyticsLoading}
								variant="inline"
							/>
						)} */}
							{user && (
								<UsageLimitsBadge
									onConnect={() => {
										const url = new URL('/oauth/login', window.location.origin);
										url.searchParams.set('return_url', window.location.pathname + window.location.search);
										window.location.href = url.toString();
									}}
								/>
							)}
							{user && (
								<button
									onClick={() => setIsLovableOpen(true)}
									className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-primary/70 hover:text-accent hover:bg-accent/10 transition-colors border border-border-primary/50 hover:border-accent/40"
									title="Import from Lovable"
								>
									<Zap className="h-3.5 w-3.5" />
									<span className="hidden sm:inline">Lovable</span>
								</button>
							)}
							{user && <ThemeToggle />}
							{!user && <ThemeToggle />}
							{!user && <AuthButton />}
						</motion.div>
					</div>
				</div>
			</motion.header>
			{hasChangeLogs && (
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>Platform updates</DialogTitle>
						{status.globalUserMessage && (
							<DialogDescription className="text-sm text-muted-foreground">
								{status.globalUserMessage}
							</DialogDescription>
						)}
					</DialogHeader>
					<ScrollArea className="max-h-[60vh] pr-4">
						<p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
							{status.changeLogs}
						</p>
					</ScrollArea>
				</DialogContent>
			)}
		</Dialog>
		</>
	);
}
