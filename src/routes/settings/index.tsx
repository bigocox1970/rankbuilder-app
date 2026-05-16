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
import { ImageIcon } from 'lucide-react';

const ADMIN_EMAIL = 'perimeter.uk@gmail.com';

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

	// Image generation toggle
	const [imageGenEnabled, setImageGenEnabled] = useState<boolean>(() => {
		try { return localStorage.getItem('imageGeneration.enabled') !== 'false'; } catch { return true; }
	});

	useEffect(() => {
		try { localStorage.setItem('imageGeneration.enabled', imageGenEnabled ? 'true' : 'false'); } catch { /* ignore */ }
	}, [imageGenEnabled]);

	// User plan
	const [planData, setPlanData] = useState<UserPlanData | null>(null);
	const [planLoading, setPlanLoading] = useState(true);

	useEffect(() => {
		if (!user) return;
		apiClient.getUserPlan()
			.then((r) => { if (r.success && r.data) setPlanData(r.data); })
			.catch(() => { /* ignore */ })
			.finally(() => setPlanLoading(false));
	}, [user]);

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
					<Card id="plan">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<CreditCard className="h-5 w-5" />
								<CardTitle>Plan &amp; Credits</CardTitle>
							</div>
						</CardHeader>
						<CardContent className="px-6 py-5 space-y-5">
							{planLoading ? (
								<div className="flex items-center gap-2">
									<Settings className="h-4 w-4 animate-spin text-text-tertiary" />
									<span className="text-sm text-text-tertiary">Loading plan info...</span>
								</div>
							) : (
								<>
									{/* Plan badge */}
									<div className="flex items-center gap-3">
										{planData?.plan === 'pro' ? (
											<Badge className="bg-accent text-black text-sm px-3 py-1 font-semibold">Pro</Badge>
										) : (
											<Badge variant="secondary" className="text-sm px-3 py-1">Free</Badge>
										)}
										<span className="text-sm text-text-secondary">
											{planData?.plan === 'pro'
												? 'Unlimited builds · Priority AI models'
												: `${planData?.dailyBuildLimit ?? 10} builds per day · Standard AI models`}
										</span>
									</div>

									<Separator />

									{/* Top-up credits */}
									<div className="space-y-2">
										<p className="text-sm font-medium text-text-primary">Top up credits</p>
										<p className="text-xs text-text-tertiary">
											One-time credit packs. Credits never expire and stack with your monthly allowance.
										</p>
										<div className="flex flex-wrap gap-3 pt-1">
											{/* £10 — base */}
											<button
												onClick={() => toast.info('Stripe billing coming soon — top-ups will be available shortly.')}
												className="relative flex flex-col items-start px-4 py-3 rounded-lg border border-bg-4 bg-bg-2 hover:border-accent/60 hover:bg-accent/5 transition-colors cursor-pointer group min-w-[120px]"
											>
												<span className="text-xl font-bold text-text-primary group-hover:text-accent transition-colors">£10</span>
												<span className="text-xs text-text-tertiary mt-1">500 credits</span>
											</button>

											{/* £20 — 10% bonus */}
											<button
												onClick={() => toast.info('Stripe billing coming soon — top-ups will be available shortly.')}
												className="relative flex flex-col items-start px-4 py-3 rounded-lg border border-accent/40 bg-accent/5 hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer group min-w-[120px]"
											>
												<span className="absolute -top-2 right-3 text-[10px] font-bold bg-accent text-black px-2 py-0.5 rounded-full">+10% free</span>
												<span className="text-xl font-bold text-text-primary group-hover:text-accent transition-colors">£20</span>
												<span className="text-xs text-text-tertiary mt-1">
													<span className="line-through opacity-50">1,000</span>
													{' '}1,100 credits
												</span>
											</button>

											{/* £50 — 20% bonus */}
											<button
												onClick={() => toast.info('Stripe billing coming soon — top-ups will be available shortly.')}
												className="relative flex flex-col items-start px-4 py-3 rounded-lg border border-accent/60 bg-accent/8 hover:border-accent hover:bg-accent/15 transition-colors cursor-pointer group min-w-[120px]"
											>
												<span className="absolute -top-2 right-3 text-[10px] font-bold bg-accent text-black px-2 py-0.5 rounded-full">+20% free</span>
												<span className="text-xl font-bold text-accent">£50</span>
												<span className="text-xs text-text-tertiary mt-1">
													<span className="line-through opacity-50">2,500</span>
													{' '}3,000 credits
												</span>
												<span className="text-[10px] text-accent font-medium mt-0.5">Best value</span>
											</button>
										</div>
										<p className="text-xs text-text-tertiary pt-1">
											~15 credits per website build &middot; 500 credits ≈ 33 builds
										</p>
									</div>

									<Separator />

									{/* Upgrade / downgrade */}
									<div className="flex items-center justify-between">
										<div>
											<p className="text-sm font-medium text-text-primary">
												{planData?.plan === 'pro' ? 'Pro subscription' : 'Upgrade to Pro'}
											</p>
											<p className="text-xs text-text-tertiary mt-0.5">
												{planData?.plan === 'pro'
													? 'Unlimited daily builds, faster AI, priority support'
													: 'Unlimited daily builds, faster AI, priority support — from £10/month'}
											</p>
										</div>
										<Button
											variant={planData?.plan === 'pro' ? 'outline' : 'default'}
											size="sm"
											className={planData?.plan === 'pro' ? '' : 'bg-accent text-black hover:bg-accent/90'}
											onClick={() => toast.info('Stripe billing coming soon — subscriptions launching shortly.')}
										>
											{planData?.plan === 'pro' ? 'Manage subscription' : 'Upgrade'}
										</Button>
									</div>
								</>
							)}
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
