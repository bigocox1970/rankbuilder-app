import React, { useState, useEffect } from 'react';
import {
	Smartphone,
	Trash2,
	Key,
	Lock,
	Settings,
	Copy,
	Check,
	Eye,
	EyeOff,
	CreditCard,
	ShieldCheck,
	ChevronRight,
	Sparkles,
	Zap,
} from 'lucide-react';
import { Link } from 'react-router';
import type {
	ActiveSessionsData,
	ApiKeysData,
	UserPlanData,
} from '@/api-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { Switch } from '@/components/ui/switch';
import { ImageIcon, Info } from 'lucide-react';

const ADMIN_EMAIL = 'perimeter.uk@gmail.com';

function TopUpButton({
	amount,
	subtitle,
	highlighted = false,
	bestValue = false,
}: {
	amount: '10' | '20' | '50';
	subtitle: string;
	highlighted?: boolean;
	bestValue?: boolean;
}) {
	const [loading, setLoading] = useState(false);
	const handleClick = async () => {
		setLoading(true);
		try {
			const result = await apiClient.createTopUpSession(amount);
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
			} else {
				toast.error('Could not start checkout. Please try again.');
			}
		} catch {
			toast.error('Could not start checkout. Please try again.');
		} finally {
			setLoading(false);
		}
	};
	return (
		<button
			disabled={loading}
			onClick={handleClick}
			className={
				bestValue
					? 'relative flex flex-col items-start px-4 py-3 rounded-lg border border-accent/60 bg-accent/8 hover:border-accent hover:bg-accent/15 transition-colors cursor-pointer group min-w-[120px]'
					: highlighted
						? 'relative flex flex-col items-start px-4 py-3 rounded-lg border border-accent/40 bg-accent/5 hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer group min-w-[120px]'
						: 'relative flex flex-col items-start px-4 py-3 rounded-lg border border-bg-4 bg-bg-2 hover:border-accent/60 hover:bg-accent/5 transition-colors cursor-pointer group min-w-[120px]'
			}
		>
			<span className={bestValue ? 'text-xl font-bold text-accent' : 'text-xl font-bold text-text-primary group-hover:text-accent transition-colors'}>£{amount}</span>
			<span className={bestValue ? 'text-base font-semibold text-accent mt-1' : 'text-base font-semibold text-text-primary mt-1'}>{loading ? '…' : subtitle}</span>
			<span className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">One-time</span>
		</button>
	);
}

export default function SettingsPage() {
	const { user } = useAuth();
	const isAdmin = user?.email === ADMIN_EMAIL;

	// Active sessions state
	const [activeSessions, setActiveSessions] = useState<
		ActiveSessionsData & { loading: boolean }
	>({ sessions: [], loading: true });

	// SDK API keys state
	const [apiKeys, setApiKeys] = useState<ApiKeysData & { loading: boolean }>({
		keys: [],
		loading: true,
	});
	const [createKeyOpen, setCreateKeyOpen] = useState(false);
	const [newKeyName, setNewKeyName] = useState('');
	const [creatingKey, setCreatingKey] = useState(false);
	const [createdKey, setCreatedKey] = useState<{
		key: string;
		keyPreview: string;
		name: string;
	} | null>(null);
	const [showCreatedKey, setShowCreatedKey] = useState(true);
	const [keyToRevoke, setKeyToRevoke] = useState<
		ApiKeysData['keys'][number] | null
	>(null);
	const [revokingKey, setRevokingKey] = useState(false);
	const {
		copied: copiedCreatedKey,
		copy: copyCreatedKey,
		reset: resetCreatedKeyCopy,
	} = useCopyToClipboard();

	// Change password state
	const [changePasswordOpen, setChangePasswordOpen] = useState(false);
	const [changePwForm, setChangePwForm] = useState({ current: '', next: '', confirm: '' });
	const [changePwLoading, setChangePwLoading] = useState(false);
	const [changePwError, setChangePwError] = useState<string | null>(null);

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setChangePwError(null);
		if (changePwForm.next !== changePwForm.confirm) {
			setChangePwError('New passwords do not match');
			return;
		}
		setChangePwLoading(true);
		try {
			const result = await apiClient.changePassword(changePwForm.current, changePwForm.next, changePwForm.confirm);
			if (result.success) {
				toast.success('Password changed successfully');
				setChangePasswordOpen(false);
				setChangePwForm({ current: '', next: '', confirm: '' });
			} else {
				setChangePwError(typeof result.error === 'string' ? result.error : 'Failed to change password');
			}
		} catch {
			setChangePwError('Something went wrong. Please try again.');
		} finally {
			setChangePwLoading(false);
		}
	};

	// Credit balance
	const [credits, setCredits] = useState<{ balance: number; buildCost: number } | null>(null);
	useEffect(() => {
		if (!user) return;
		apiClient.getCreditsBalance()
			.then(r => { if (r.success && r.data) setCredits(r.data); })
			.catch(() => { /* ignore */ });
	}, [user]);

	// Image generation toggle
	const [imageGenEnabled, setImageGenEnabled] = useState<boolean>(() => {
		try { return localStorage.getItem('imageGeneration.enabled') !== 'false'; } catch { return true; }
	});

	useEffect(() => {
		try { localStorage.setItem('imageGeneration.enabled', imageGenEnabled ? 'true' : 'false'); } catch { /* ignore */ }
	}, [imageGenEnabled]);

	// User plan
	const [planData, setPlanData] = useState<UserPlanData | null>(null);
	const [, setPlanLoading] = useState(true);
	const [billingLoading, setBillingLoading] = useState(false);

	useEffect(() => {
		if (!user) return;
		apiClient.getUserPlan()
			.then((r) => { if (r.success && r.data) setPlanData(r.data); })
			.catch(() => { /* ignore */ })
			.finally(() => setPlanLoading(false));
	}, [user]);

	const handleUpgrade = async () => {
		setBillingLoading(true);
		try {
			const result = await apiClient.createCheckoutSession();
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
			} else {
				toast.error('Could not start checkout. Please try again.');
			}
		} catch {
			toast.error('Could not start checkout. Please try again.');
		} finally {
			setBillingLoading(false);
		}
	};

	const handleManageBilling = async () => {
		setBillingLoading(true);
		try {
			const result = await apiClient.createPortalSession();
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
			} else {
				toast.error('Could not open billing portal. Please try again.');
			}
		} catch {
			toast.error('Could not open billing portal. Please try again.');
		} finally {
			setBillingLoading(false);
		}
	};

	const handleDeleteAccount = async () => {
		toast.error('Account deletion is not yet implemented');
	};

	const loadActiveSessions = async () => {
		try {
			const response = await apiClient.getActiveSessions();
			setActiveSessions({
				sessions: response.data?.sessions || [
					{
						id: 'current',
						userAgent: navigator.userAgent,
						ipAddress: 'Current location',
						lastActivity: new Date(),
						createdAt: new Date(),
						isCurrent: true,
					},
				],
				loading: false,
			});
		} catch {
			setActiveSessions({
				sessions: [
					{
						id: 'current',
						userAgent: navigator.userAgent,
						ipAddress: 'Current location',
						lastActivity: new Date(),
						createdAt: new Date(),
						isCurrent: true,
					},
				],
				loading: false,
			});
		}
	};

	const handleRevokeSession = async (sessionId: string) => {
		try {
			await apiClient.revokeSession(sessionId);
			toast.success('Session revoked successfully');
			loadActiveSessions();
		} catch {
			toast.error('Failed to revoke session');
		}
	};

	const loadApiKeys = async () => {
		try {
			setApiKeys((prev) => ({ ...prev, loading: true }));
			const response = await apiClient.getApiKeys();
			setApiKeys({ keys: response.data?.keys ?? [], loading: false });
		} catch {
			setApiKeys({ keys: [], loading: false });
			toast.error('Failed to load API keys');
		}
	};

	const handleCreateApiKey = async () => {
		if (!newKeyName.trim() || creatingKey) return;
		try {
			setCreatingKey(true);
			const response = await apiClient.createApiKey({ name: newKeyName.trim() });
			if (response.success && response.data) {
				setCreatedKey({
					key: response.data.key,
					keyPreview: response.data.keyPreview,
					name: response.data.name,
				});
				setShowCreatedKey(true);
				resetCreatedKeyCopy();
				toast.success('API key created');
				await loadApiKeys();
				setNewKeyName('');
			}
		} catch {
			toast.error('Failed to create API key');
		} finally {
			setCreatingKey(false);
		}
	};

	const handleRevokeApiKey = async () => {
		if (!keyToRevoke || revokingKey) return;
		try {
			setRevokingKey(true);
			await apiClient.revokeApiKey(keyToRevoke.id);
			toast.success('API key revoked');
			setKeyToRevoke(null);
			await loadApiKeys();
		} catch {
			toast.error('Failed to revoke API key');
		} finally {
			setRevokingKey(false);
		}
	};

	React.useEffect(() => {
		if (user) {
			loadActiveSessions();
			loadApiKeys();
		}
	}, [user]);

	return (
		<div className="min-h-screen bg-bg-3 relative">
			<main className="container mx-auto px-4 py-8 max-w-4xl">
				<div className="space-y-8">
					{/* Page Header */}
					<div className="flex items-start justify-between">
						<div>
							<h1 className="text-4xl font-bold tracking-tight text-accent">
								Settings
							</h1>
							<p className="text-text-tertiary mt-2">
								Manage your account settings and preferences
							</p>
						</div>
						{isAdmin && (
							<Link to="/admin">
								<Button variant="outline" className="gap-2 border-accent/40 text-accent hover:bg-accent/10">
									<ShieldCheck className="h-4 w-4" />
									Admin Panel
									<ChevronRight className="h-4 w-4" />
								</Button>
							</Link>
						)}
					</div>

					{/* Credits & Plan */}
					<Card
						id="plan"
						className={planData?.plan === 'pro' ? 'border-accent/60 shadow-[0_0_0_1px_rgba(0,230,118,0.25),0_4px_24px_-8px_rgba(0,230,118,0.35)]' : undefined}
					>
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<CreditCard className="h-5 w-5" />
								<CardTitle>Plan &amp; Credits</CardTitle>
							</div>
						</CardHeader>
						<CardContent className="px-6 py-5 space-y-5">
							{/* Credit balance */}
							<div className="rounded-lg bg-gradient-to-br from-accent/15 via-accent/8 to-transparent border border-accent/40 p-5">
								<div className="flex items-start justify-between gap-4 flex-wrap">
									<div className="flex items-center gap-3">
										<div className="size-10 rounded-full bg-accent/20 flex items-center justify-center">
											<Zap className="size-5 text-accent" />
										</div>
										<div>
											<div className="flex items-center gap-1.5">
												<p className="text-xs uppercase tracking-wider text-text-tertiary">Credit balance</p>
												<Dialog>
													<DialogTrigger asChild>
														<button
															type="button"
															className="text-text-tertiary hover:text-accent transition-colors"
															aria-label="What are credits?"
														>
															<Info className="size-3.5" />
														</button>
													</DialogTrigger>
													<DialogContent className="max-w-md">
														<DialogHeader>
															<DialogTitle>How credits work</DialogTitle>
															<DialogDescription>
																Credits deduct in real time as the AI works — different operations cost different amounts.
															</DialogDescription>
														</DialogHeader>
														<div className="space-y-3 text-sm text-text-secondary">
															<p className="text-text-secondary">Rough guide:</p>
															<div className="flex justify-between gap-4 border-b border-bg-3 pb-2">
																<span>A simple new app (small prompt, one-shot)</span>
																<span className="font-mono text-text-primary">~10–20</span>
															</div>
															<div className="flex justify-between gap-4 border-b border-bg-3 pb-2">
																<span>A typical app build (with images + a few fixes)</span>
																<span className="font-mono text-text-primary">~30–80</span>
															</div>
															<div className="flex justify-between gap-4 border-b border-bg-3 pb-2">
																<span>A complex app with many bug-fix cycles</span>
																<span className="font-mono text-text-primary">100+</span>
															</div>
															<div className="flex justify-between gap-4 border-b border-bg-3 pb-2">
																<span>A single image regeneration</span>
																<span className="font-mono text-text-primary">~2</span>
															</div>
															<div className="flex justify-between gap-4">
																<span>A small chat message to Orange</span>
																<span className="font-mono text-text-primary">~1</span>
															</div>
															<p className="text-xs text-text-tertiary pt-2">
																Every AI call deducts credits proportional to the model + work done. You'll see your balance tick down. When it can't cover the next call, the chat halts and we prompt you to top up.
															</p>
														</div>
													</DialogContent>
												</Dialog>
											</div>
											<p className="text-2xl font-bold text-text-primary mt-0.5">
												{credits === null ? '—' : credits.balance.toLocaleString()}
											</p>
										</div>
									</div>
									{planData?.plan === 'pro' && (
										<div className="flex flex-col items-end gap-1.5">
											<div className="flex items-center gap-2">
												<Sparkles className="size-4 text-accent" />
												<span className="text-sm font-semibold text-text-primary">Pro</span>
												<Badge className="bg-accent text-black text-[10px] px-2 py-0 font-bold uppercase tracking-wider">Active</Badge>
											</div>
											<p className="text-xs text-text-tertiary">£20/mo · 1,500 credits monthly</p>
											<Button
												variant="outline"
												size="sm"
												className="mt-1 border-accent/40 hover:border-accent hover:bg-accent/10"
												disabled={billingLoading}
												onClick={handleManageBilling}
											>
												Manage subscription
											</Button>
										</div>
									)}
								</div>
							</div>

							<Separator />

							{/* Pro subscription upsell — only when NOT a Pro subscriber */}
							{planData?.plan !== 'pro' && (
								<div className="rounded-lg bg-gradient-to-br from-accent/15 via-accent/8 to-transparent border-2 border-accent/50 p-5 relative">
									<Badge className="absolute -top-2 left-4 bg-accent text-black text-[10px] px-2 py-0 font-bold uppercase tracking-wider">Best value</Badge>
									<div className="flex items-start justify-between gap-4 flex-wrap">
										<div className="flex items-start gap-3 flex-1 min-w-0">
											<div className="size-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
												<Sparkles className="size-5 text-accent" />
											</div>
											<div className="min-w-0">
												<p className="text-2xl font-bold text-text-primary">
													1,500 credits
													<span className="text-sm font-normal text-text-tertiary"> / month</span>
												</p>
												<p className="text-sm text-text-secondary mt-1">
													<span className="font-semibold text-accent">£20 / month</span> — automatically refreshes
												</p>
												<p className="text-xs text-text-tertiary mt-2">
													50% more credits than a £20 one-time top-up (1,000). Cancel anytime.
												</p>
											</div>
										</div>
										<Button
											size="sm"
											className="bg-accent text-black hover:bg-accent/90 font-semibold"
											disabled={billingLoading}
											onClick={handleUpgrade}
										>
											Upgrade to Pro
										</Button>
									</div>
								</div>
							)}

							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Sparkles className="size-4 text-text-secondary" />
									<p className="text-sm font-medium text-text-primary">Or buy a top-up</p>
								</div>
								<p className="text-xs text-text-tertiary">One-off credit packs. Never expire.</p>
								<div className="flex flex-wrap gap-3 pt-1">
									<TopUpButton amount="10" subtitle="400 credits" />
									<TopUpButton amount="20" subtitle="1,000 credits" highlighted />
									<TopUpButton amount="50" subtitle="2,500 credits" bestValue />
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Image Generation */}
					<Card id="image-generation">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<ImageIcon className="h-5 w-5" />
								<div>
									<CardTitle>Image Generation</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4 px-6 mt-4">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-sm font-medium text-text-primary">AI hero images for websites</p>
									<p className="text-xs text-text-tertiary mt-0.5">
										Generate real images using Cloudflare AI when building a website. Turn off for faster iteration.
									</p>
								</div>
								<Switch
									checked={imageGenEnabled}
									onCheckedChange={setImageGenEnabled}
								/>
							</div>
						</CardContent>
					</Card>

					{/* API Keys */}
					<Card id="api-keys">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<Key className="h-5 w-5" />
								<div>
									<CardTitle>API Keys</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4 mt-4 px-6">
							<div className="flex items-start justify-between gap-4">
								<div className="space-y-1">
									<h4 className="font-medium text-sm">VibeSDK API Keys</h4>
									<p className="text-sm text-text-secondary">
										Use these keys to authenticate external SDK clients. The full key is shown only once when created.
									</p>
								</div>

								<Dialog
									open={createKeyOpen}
									onOpenChange={(open) => {
										setCreateKeyOpen(open);
										if (!open) {
											setNewKeyName('');
											setCreatedKey(null);
											setShowCreatedKey(true);
											resetCreatedKeyCopy();
										}
									}}
								>
									<DialogTrigger asChild>
										<Button size="sm" className="gap-2">
											<Key className="h-4 w-4" />
											Create API Key
										</Button>
									</DialogTrigger>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>
												{createdKey ? 'Your new API key' : 'Create API key'}
											</DialogTitle>
											<DialogDescription>
												{createdKey
													? 'Copy this key now. You will not be able to see it again.'
													: 'Give your key a memorable name. You can revoke it anytime.'}
											</DialogDescription>
										</DialogHeader>

										{!createdKey ? (
											<div className="space-y-3">
												<div className="space-y-2">
													<p className="text-sm font-medium">Key name</p>
													<Input
														value={newKeyName}
														onChange={(e) => setNewKeyName(e.target.value)}
														placeholder="e.g. My production SDK"
														autoFocus
													/>
												</div>
												<div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3">
													<p className="text-sm text-amber-800 dark:text-amber-200">
														<strong>Important:</strong> Treat this like a password. Anyone with this key can act as your VibeSDK account.
													</p>
												</div>
											</div>
										) : (
											<div className="space-y-3">
												<div className="space-y-2">
													<p className="text-sm font-medium">API key</p>
													<div className="relative">
														<Input
															type={showCreatedKey ? 'text' : 'password'}
															value={createdKey.key}
															readOnly
															className="font-mono text-sm pr-20"
														/>
														<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
															<Button
																size="icon"
																variant="ghost"
																className="h-7 w-7"
																onClick={() => setShowCreatedKey(!showCreatedKey)}
															>
																{showCreatedKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
															</Button>
															<Button
																size="icon"
																variant="ghost"
																className="h-7 w-7"
																onClick={() => copyCreatedKey(createdKey.key)}
															>
																{copiedCreatedKey ? (
																	<Check className="h-4 w-4 text-green-500" />
																) : (
																	<Copy className="h-4 w-4" />
																)}
															</Button>
														</div>
													</div>
												</div>
												<div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
													<p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">SDK usage</p>
													<code className="text-xs text-slate-600 dark:text-slate-400 block font-mono">
														VIBESDK_API_KEY={createdKey.keyPreview}
													</code>
												</div>
											</div>
										)}

										<DialogFooter>
											{!createdKey ? (
												<Button
													onClick={handleCreateApiKey}
													disabled={!newKeyName.trim() || creatingKey}
													className="gap-2"
												>
													{creatingKey ? (
														<>
															<Settings className="h-4 w-4 animate-spin" />
															Creating...
														</>
													) : (
														'Create'
													)}
												</Button>
											) : (
												<Button
													variant="outline"
													onClick={() => setCreateKeyOpen(false)}
												>
													Done
												</Button>
											)}
										</DialogFooter>
									</DialogContent>
								</Dialog>
							</div>

							{apiKeys.loading ? (
								<div className="flex items-center gap-3">
									<Settings className="h-5 w-5 animate-spin text-text-tertiary" />
									<span className="text-sm text-text-tertiary">Loading API keys...</span>
								</div>
							) : apiKeys.keys.length === 0 ? (
								<div className="rounded-lg border border-dashed border-bg-4 bg-bg-2/50 p-6">
									<div className="flex items-start gap-3">
										<div className="h-10 w-10 rounded-full bg-bg-3 flex items-center justify-center">
											<Key className="h-5 w-5 text-text-tertiary" />
										</div>
										<div className="space-y-1">
											<p className="font-medium">No API keys yet</p>
											<p className="text-sm text-text-tertiary">
												Create an API key to use the VibeSDK SDK from your own apps.
											</p>
										</div>
									</div>
								</div>
							) : (
								<>
									<Table>
										<TableCaption>Active keys for SDK usage</TableCaption>
										<TableHeader>
											<TableRow>
												<TableHead>Name</TableHead>
												<TableHead>Preview</TableHead>
												<TableHead>Created</TableHead>
												<TableHead>Last used</TableHead>
												<TableHead>Status</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{apiKeys.keys.map((k) => (
												<TableRow key={k.id}>
													<TableCell className="font-medium">{k.name}</TableCell>
													<TableCell className="font-mono text-xs text-text-secondary">{k.keyPreview}</TableCell>
													<TableCell className="text-text-secondary">
														{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}
													</TableCell>
													<TableCell className="text-text-secondary">
														{k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : '—'}
													</TableCell>
													<TableCell>
														{k.isActive ? (
															<Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">
																Active
															</Badge>
														) : (
															<Badge variant="secondary">Revoked</Badge>
														)}
													</TableCell>
													<TableCell className="text-right">
														<Button
															variant="outline"
															size="sm"
															disabled={!k.isActive}
															onClick={() => setKeyToRevoke(k)}
															className="gap-2 text-destructive hover:text-destructive"
														>
															<Trash2 className="h-4 w-4" />
															Revoke
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>

									<AlertDialog open={!!keyToRevoke} onOpenChange={(open) => !open && setKeyToRevoke(null)}>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Revoke API key?</AlertDialogTitle>
												<AlertDialogDescription>
													This will immediately disable the key <span className="font-mono">{keyToRevoke?.keyPreview}</span>. Any SDK clients using it will stop working.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel disabled={revokingKey}>Cancel</AlertDialogCancel>
												<AlertDialogAction
													onClick={handleRevokeApiKey}
													disabled={revokingKey}
													className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
												>
													{revokingKey ? 'Revoking…' : 'Revoke key'}
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</>
							)}
						</CardContent>
					</Card>

					{/* Security */}
					<Card id="security">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<Lock className="h-5 w-5" />
								<div>
									<CardTitle className="text-lg">Security</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-3 mt-2 px-6">
							<div className="space-y-2">
								<h4 className="font-medium">Connected Accounts</h4>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="h-5 w-5 rounded-full bg-bg-3 flex items-center justify-center">
											{user?.provider === 'google' ? '🇬' : '🐙'}
										</div>
										<div>
											<p className="text-sm font-medium capitalize">{user?.provider}</p>
											<p className="text-sm text-text-tertiary">{user?.email}</p>
										</div>
									</div>
									<Badge variant="secondary">Connected</Badge>
								</div>
							</div>

							<Separator />

							<div className="space-y-2">
								<h4 className="font-medium">Active Sessions</h4>
								{activeSessions.loading ? (
									<div className="flex items-center gap-3">
										<Settings className="h-5 w-5 animate-spin text-text-tertiary" />
										<span className="text-sm text-text-tertiary">Loading active sessions...</span>
									</div>
								) : (
									activeSessions.sessions.map((session) => (
										<div key={session.id} className="flex items-center justify-between">
											<div className="flex items-center gap-3">
												<Smartphone className="h-5 w-5 text-text-tertiary" />
												<div>
													<p className="font-medium text-sm">
														{session.isCurrent ? 'Current Session' : 'Other Session'}
													</p>
													<p className="text-sm text-text-tertiary">
														{session.ipAddress} &middot;{' '}
														{new Date(session.lastActivity).toLocaleDateString()}
													</p>
												</div>
											</div>
											<div className="flex items-center gap-2">
												{session.isCurrent ? (
													<div className="bg-green-400 size-3 rounded-full ring-green-200 ring-2 animate-pulse" />
												) : (
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleRevokeSession(session.id)}
														className="text-destructive hover:text-destructive"
													>
														Revoke
													</Button>
												)}
											</div>
										</div>
									))
								)}
							</div>

							{user?.provider === 'email' && (
								<>
									<Separator />
									<div className="space-y-2">
										<h4 className="font-medium">Password</h4>
										{changePasswordOpen ? (
											<form onSubmit={handleChangePassword} className="space-y-3">
												{changePwError && (
													<p className="text-sm text-destructive">{changePwError}</p>
												)}
												<Input
													type="password"
													placeholder="Current password"
													value={changePwForm.current}
													onChange={(e) => setChangePwForm(f => ({ ...f, current: e.target.value }))}
													disabled={changePwLoading}
													required
												/>
												<Input
													type="password"
													placeholder="New password"
													value={changePwForm.next}
													onChange={(e) => setChangePwForm(f => ({ ...f, next: e.target.value }))}
													disabled={changePwLoading}
													required
												/>
												<Input
													type="password"
													placeholder="Confirm new password"
													value={changePwForm.confirm}
													onChange={(e) => setChangePwForm(f => ({ ...f, confirm: e.target.value }))}
													disabled={changePwLoading}
													required
												/>
												<div className="flex gap-2">
													<Button type="submit" size="sm" disabled={changePwLoading}>
														{changePwLoading ? 'Saving...' : 'Save'}
													</Button>
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() => { setChangePasswordOpen(false); setChangePwError(null); setChangePwForm({ current: '', next: '', confirm: '' }); }}
													>
														Cancel
													</Button>
												</div>
											</form>
										) : (
											<Button variant="outline" size="sm" onClick={() => setChangePasswordOpen(true)}>
												Change password
											</Button>
										)}
									</div>
								</>
							)}
						</CardContent>
					</Card>

					{/* Danger Zone */}
					<div className="space-y-4 p-3">
						<h4 className="font-medium text-destructive">Danger Zone</h4>
						<div className="flex items-center justify-between">
							<div>
								<p className="font-medium text-text-primary">Delete Account</p>
								<p className="text-sm text-text-tertiary">
									Permanently delete your account and all data
								</p>
							</div>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<Trash2 className="h-4 w-4" />
										Delete Account
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
										<AlertDialogDescription>
											This action cannot be undone. This will permanently delete your account and remove all your data from our servers.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleDeleteAccount}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											Delete Account
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
