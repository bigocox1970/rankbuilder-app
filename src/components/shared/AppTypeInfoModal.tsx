import React from 'react';
import { Globe, Smartphone, LayoutGrid, Search, AppWindow, Home } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { AppType } from 'shared/constants/templates';

interface AppTypeInfoModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The card's own type — emphasised in the list so the user sees their context. */
	highlightType?: AppType | null;
}

interface TypeInfo {
	type: AppType;
	label: string;
	Icon: LucideIcon;
	tagline: string;
	body: React.ReactNode;
}

const TYPE_INFO: TypeInfo[] = [
	{
		type: 'website',
		label: 'Website (HTML)',
		Icon: Globe,
		tagline: 'Marketing pages and content you want found on Google.',
		body: (
			<>
				<p>
					A fast, static HTML site — ideal for marketing pages, landing pages,
					and any content where being found matters.
				</p>
				<p className="flex items-start gap-2">
					<Search className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
					<span>
						Because it's plain HTML, Google and other search engines can
						reliably crawl and index every page. <strong>Choose this when SEO
						and getting discovered on Google matter most.</strong>
					</span>
				</p>
			</>
		),
	},
	{
		type: 'mobile',
		label: 'Mobile app (Expo)',
		Icon: Smartphone,
		tagline: 'A real iOS + Android app to publish to the App Store / Play Store.',
		body: (
			<>
				<p>
					A true cross-platform mobile app for iOS and Android, built with React
					Native (Expo) — previewable live on your phone as you build.
				</p>
				<p>
					<strong>Choose this if you intend to publish to the Apple App Store
					or Google Play.</strong> RankBuilder builds and previews the app, but
					submitting to the stores is done through your own Apple and Google
					developer accounts — not through RankBuilder (for now).
				</p>
			</>
		),
	},
	{
		type: 'webapp',
		label: 'Web app (React) — and PWA',
		Icon: LayoutGrid,
		tagline: 'Interactive dashboards and tools — and your own installable app, no app store.',
		body: (
			<>
				<p>
					An interactive React web app — perfect for dashboards, tools, and
					data-driven apps. Connect it to <strong>Supabase</strong> for a real
					database, accounts/auth, and backend, and you've got a fully working
					product.
				</p>
				<div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
					<p className="flex items-center gap-2 font-semibold text-text-primary">
						<AppWindow className="h-4 w-4 text-accent" />
						It's also a PWA — your own app, no app store
					</p>
					<p className="mt-1.5">
						A PWA (Progressive Web App) is a website that can be installed like a
						native app. Your users open it and choose{' '}
						<span className="inline-flex items-center gap-1 font-medium text-text-primary">
							<Home className="h-3.5 w-3.5" /> Add to Home Screen
						</span>{' '}
						— and they get an app icon that opens full-screen, just like a real
						app.
					</p>
					<p className="mt-1.5">
						That means an installable, data-backed app on as many phones and
						devices as you like — with <strong>no App Store, no Apple or Google
						developer accounts, and no approval process.</strong> The fastest way
						to put a working app on someone's phone.
					</p>
				</div>
			</>
		),
	},
];

export const AppTypeInfoModal: React.FC<AppTypeInfoModalProps> = ({
	open,
	onOpenChange,
	highlightType,
}) => {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Which type should I choose?</DialogTitle>
					<DialogDescription>
						Every app on RankBuilder is one of three types. Here's what each is
						best for, so you can pick the right starting point.
					</DialogDescription>
				</DialogHeader>

				<div className="mt-2 space-y-4">
					{TYPE_INFO.map(({ type, label, Icon, tagline, body }) => {
						const highlighted = highlightType === type;
						return (
							<section
								key={type}
								className={cn(
									'rounded-xl border p-4 transition-colors',
									highlighted
										? 'border-accent bg-accent/5'
										: 'border-border-primary bg-bg-3/40',
								)}
							>
								<div className="flex items-center gap-2">
									<span
										className={cn(
											'flex h-8 w-8 items-center justify-center rounded-lg',
											highlighted ? 'bg-accent text-black' : 'bg-bg-4 text-text-primary',
										)}
									>
										<Icon className="h-4 w-4" />
									</span>
									<div>
										<h3 className="font-semibold text-text-primary leading-tight">
											{label}
											{highlighted && (
												<span className="ml-2 align-middle text-[10px] font-medium uppercase tracking-wide text-accent">
													This app
												</span>
											)}
										</h3>
										<p className="text-xs text-text-tertiary">{tagline}</p>
									</div>
								</div>
								<div className="mt-3 space-y-2 text-sm text-text-secondary">
									{body}
								</div>
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
};
