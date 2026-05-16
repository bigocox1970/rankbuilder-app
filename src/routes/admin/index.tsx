import React, { useState, useEffect, useRef } from 'react';
import {
	Settings,
	DollarSign,
	Users,
	ExternalLink,
	Key,
} from 'lucide-react';
import { Link } from 'react-router';
import { ModelConfigTabs } from '@/components/model-config-tabs';
import type {
	ModelConfigsData,
	ModelConfigUpdate,
	AdminGatewayCostData,
	AdminUsersData,
	AdminUserEntry,
} from '@/api-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { CloudflareAccountSelector } from '@/components/cloudflare-account-selector';

const ADMIN_EMAIL = 'perimeter.uk@gmail.com';

export default function AdminPage() {
	const { user } = useAuth();
	const isAdmin = user?.email === ADMIN_EMAIL;

	// Model configurations state
	const [agentConfigs, setAgentConfigs] = useState<
		Array<{ key: string; name: string; description: string }>
	>([]);
	const [modelConfigs, setModelConfigs] = useState<
		ModelConfigsData['configs']
	>({} as ModelConfigsData['configs']);
	const [defaultConfigs, setDefaultConfigs] = useState<
		ModelConfigsData['defaults']
	>({} as ModelConfigsData['defaults']);
	const [loadingConfigs, setLoadingConfigs] = useState(true);
	const [savingConfigs, setSavingConfigs] = useState(false);
	const [testingConfig, setTestingConfig] = useState<string | null>(null);

	// Helper function to format camelCase to human readable
	const formatAgentConfigName = React.useCallback((key: string) => {
		return key
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, (str) => str.toUpperCase())
			.trim();
	}, []);

	// Helper function to provide descriptions based on key patterns
	const getAgentConfigDescription = React.useCallback(
		(key: string) => {
			const descriptions: Record<string, string> = {
				templateSelection:
					'Quick template selection - Needs to be extremely fast with low latency. Intelligence level is less important than speed for rapid project bootstrapping.',
				blueprint:
					'Project architecture & UI design - Requires strong design thinking, UI/UX understanding, and architectural planning skills. Speed is important but coding ability is not critical.',
				projectSetup:
					'Technical scaffolding setup - Must excel at following technical instructions precisely and setting up proper project structure. Reliability and instruction-following are key.',
				phaseGeneration:
					'Development phase planning - Needs rapid planning abilities with large context windows for understanding project scope. Quick thinking is essential, coding skills are not required.',
				firstPhaseImplementation:
					'Initial development phase - Requires large context windows and excellent coding skills for implementing the foundation. Deep thinking is less critical than execution.',
				phaseImplementation:
					'Subsequent development phases - Needs large context windows and superior coding abilities for complex feature implementation. Focus is on execution rather than reasoning.',
				realtimeCodeFixer:
					'Real-time bug detection - Must be extremely fast at identifying and fixing code issues with strong debugging skills. Large context windows are not needed, speed is crucial.',
				fastCodeFixer:
					'Ultra-fast code fixes - Optimized for maximum speed with decent coding ability. No deep thinking or large context required, pure speed and basic bug fixing.',
				conversationalResponse:
					'User chat interactions - Handles natural conversation flow and user communication. Balanced capabilities for engaging dialogue and helpful responses.',
				userSuggestionProcessor:
					'User feedback processing - Analyzes and implements user suggestions and feedback. Requires understanding user intent and translating to actionable changes.',
				codeReview:
					'Code quality analysis - Needs large context windows, strong analytical thinking, and good speed for thorough code review. Must identify issues and suggest improvements.',
				fileRegeneration:
					'File recreation - Focused on pure coding ability to regenerate or rewrite files. No context window or deep thinking required, just excellent code generation.',
				screenshotAnalysis:
					'UI/design analysis - Analyzes visual designs and screenshots to understand UI requirements. Requires visual understanding and design interpretation skills.',
			};
			return (
				descriptions[key] ||
				`AI model configuration for ${formatAgentConfigName(key)}`
			);
		},
		[formatAgentConfigName],
	);

	// Load model configurations
	const loadModelConfigs = async () => {
		try {
			setLoadingConfigs(true);
			const response = await apiClient.getModelConfigs();

			if (response.success && response.data) {
				setModelConfigs(response.data.configs || {});
				setDefaultConfigs(response.data.defaults || {});
			} else {
				throw new Error(
					response.error?.message || 'Failed to load model configurations',
				);
			}
		} catch (error) {
			console.error('Error loading model configurations:', error);
			toast.error('Failed to load model configurations');
		} finally {
			setLoadingConfigs(false);
		}
	};

	// Save model configuration
	const saveModelConfig = async (
		agentAction: string,
		config: ModelConfigUpdate,
	) => {
		try {
			const response = await apiClient.updateModelConfig(agentAction, config);

			if (response.success) {
				toast.success('Configuration saved successfully');
				await loadModelConfigs();
			}
		} catch (error) {
			console.error('Error saving model configuration:', error);
			toast.error('Failed to save configuration');
		}
	};

	// Test model configuration
	const testModelConfig = async (
		agentAction: string,
		tempConfig?: ModelConfigUpdate,
	) => {
		try {
			setTestingConfig(agentAction);
			const response = await apiClient.testModelConfig(agentAction, tempConfig);

			if (response.success && response.data) {
				const result = response.data.testResult;
				if (result.success) {
					toast.success(
						`Test successful! Model: ${result.modelUsed}, Response time: ${result.latencyMs}ms`,
					);
				} else {
					toast.error(`Test failed: ${result.error}`);
				}
			}
		} catch (error) {
			console.error('Error testing configuration:', error);
			toast.error('Failed to test configuration');
		} finally {
			setTestingConfig(null);
		}
	};

	// Reset configuration to default
	const resetConfigToDefault = async (agentAction: string) => {
		try {
			await apiClient.resetModelConfig(agentAction);
			toast.success('Configuration reset to default');
			await loadModelConfigs();
		} catch (error) {
			console.error('Error resetting configuration:', error);
			toast.error('Failed to reset configuration');
		}
	};

	// Reset all configurations
	const resetAllConfigs = async () => {
		try {
			setSavingConfigs(true);
			const response = await apiClient.resetAllModelConfigs();
			toast.success(
				`${response.data?.resetCount} configurations reset to defaults`,
			);
			await loadModelConfigs();
		} catch (error) {
			console.error('Error resetting all configurations:', error);
			toast.error('Failed to reset all configurations');
		} finally {
			setSavingConfigs(false);
		}
	};

	// -------------------------------------------------------
	// Admin: Cost Dashboard
	// -------------------------------------------------------
	type CostPeriod = '24h' | '7d' | '30d' | 'all';
	const [costPeriod, setCostPeriod] = useState<CostPeriod>('7d');
	const [gatewayData, setGatewayData] = useState<AdminGatewayCostData | null>(null);
	const [gatewayLoading, setGatewayLoading] = useState(false);
	const [gatewayError, setGatewayError] = useState<string | null>(null);

	const loadGatewayCosts = React.useCallback(async (period: CostPeriod) => {
		if (!isAdmin) return;
		const gPeriod = period === 'all' ? '30d' : period;
		setGatewayLoading(true);
		setGatewayError(null);
		try {
			const response = await apiClient.getAdminGatewayCosts(gPeriod);
			if (response.success && response.data) {
				setGatewayData(response.data);
			} else {
				setGatewayError('Could not load AI Gateway data');
			}
		} catch (error) {
			console.error('Error loading gateway costs', error);
			setGatewayError('Could not load AI Gateway data');
		} finally {
			setGatewayLoading(false);
		}
	}, [isAdmin]);

	// -------------------------------------------------------
	// Admin: User Management
	// -------------------------------------------------------
	const [userSearch, setUserSearch] = useState('');
	const [userStatus, setUserStatus] = useState<'all' | 'active' | 'suspended'>('all');
	const [userPage, setUserPage] = useState(1);
	const [usersData, setUsersData] = useState<AdminUsersData | null>(null);
	const [usersLoading, setUsersLoading] = useState(false);
	// Track per-user KV override state in component (userId -> hasOverride)
	const [kvOverrides, setKvOverrides] = useState<Record<string, boolean>>({});
	const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
	const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadUsers = React.useCallback(async (
		search: string,
		status: 'all' | 'active' | 'suspended',
		page: number,
	) => {
		if (!isAdmin) return;
		setUsersLoading(true);
		try {
			const response = await apiClient.getAdminUsers({ search, status, page, limit: 20 });
			if (response.success && response.data) {
				setUsersData(response.data);
				// Fetch KV status for each user (fire sequentially to avoid hammering)
				const overrides: Record<string, boolean> = {};
				await Promise.all(
					response.data.users.map(async (u: AdminUserEntry) => {
						try {
							const kv = await apiClient.getUserKvStatus(u.id);
							overrides[u.id] = kv.data?.hasOverride ?? false;
						} catch {
							overrides[u.id] = false;
						}
					})
				);
				setKvOverrides((prev) => ({ ...prev, ...overrides }));
			}
		} catch (error) {
			console.error('Error loading users', error);
			toast.error('Failed to load users');
		} finally {
			setUsersLoading(false);
		}
	}, [isAdmin]);

	const handleUserSearch = (value: string) => {
		setUserSearch(value);
		setUserPage(1);
		if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		searchDebounceRef.current = setTimeout(() => {
			loadUsers(value, userStatus, 1);
		}, 300);
	};

	const handleUserStatusFilter = (value: 'all' | 'active' | 'suspended') => {
		setUserStatus(value);
		setUserPage(1);
		loadUsers(userSearch, value, 1);
	};

	const handleUserAction = async (
		userId: string,
		action: 'suspend' | 'unsuspend' | 'upgrade' | 'downgrade',
	) => {
		setActionLoading((prev) => ({ ...prev, [`${userId}:${action}`]: true }));
		try {
			let response;
			if (action === 'suspend') response = await apiClient.suspendUser(userId);
			else if (action === 'unsuspend') response = await apiClient.unsuspendUser(userId);
			else if (action === 'upgrade') {
				response = await apiClient.upgradeUser(userId);
				if (response.success) setKvOverrides((prev) => ({ ...prev, [userId]: true }));
			} else {
				response = await apiClient.downgradeUser(userId);
				if (response.success) setKvOverrides((prev) => ({ ...prev, [userId]: false }));
			}

			if (response?.success) {
				toast.success(response.data?.message ?? 'Done');
				// Reload the list to reflect suspend/unsuspend changes
				if (action === 'suspend' || action === 'unsuspend') {
					await loadUsers(userSearch, userStatus, userPage);
				}
			}
		} catch (error) {
			console.error(`Error performing ${action}`, error);
			toast.error(`Failed to ${action} user`);
		} finally {
			setActionLoading((prev) => ({ ...prev, [`${userId}:${action}`]: false }));
		}
	};

	// Load admin data on mount
	React.useEffect(() => {
		if (!isAdmin) return;
		loadGatewayCosts(costPeriod);
		loadUsers(userSearch, userStatus, userPage);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isAdmin]);

	// Reload cost data when period changes
	useEffect(() => {
		if (!isAdmin) return;
		loadGatewayCosts(costPeriod);
	}, [costPeriod, isAdmin, loadGatewayCosts]);

	// Load agent configurations dynamically from API
	React.useEffect(() => {
		if (!isAdmin) return;
		apiClient
			.getModelDefaults()
			.then((response) => {
				if (response.success && response.data?.defaults) {
					const configs = Object.keys(response.data.defaults).map((key) => ({
						key,
						name: formatAgentConfigName(key),
						description: getAgentConfigDescription(key),
					}));
					setAgentConfigs(configs);
				}
			})
			.catch((error) => {
				console.error('Failed to load agent configurations:', error);
			});
	}, [isAdmin, formatAgentConfigName, getAgentConfigDescription]);

	// Load model configs on mount
	React.useEffect(() => {
		if (isAdmin) loadModelConfigs();
	}, [isAdmin]);

	if (!isAdmin) {
		return (
			<div className="min-h-screen bg-bg-3 flex items-center justify-center">
				<div className="text-center space-y-3">
					<p className="text-2xl font-bold text-text-primary">Access denied</p>
					<p className="text-text-tertiary">You do not have permission to view this page.</p>
					<Link to="/settings">
						<Button variant="outline" className="mt-2">Back to Settings</Button>
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-bg-3 relative">
			<main className="container mx-auto px-4 py-8 max-w-4xl">
				<div className="space-y-8">
					{/* Page Header */}
					<div>
						<Link
							to="/settings"
							className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors mb-4"
						>
							← Settings
						</Link>
						<h1 className="text-4xl font-bold tracking-tight text-accent">
							Admin Panel
						</h1>
						<p className="text-text-tertiary mt-2">
							System administration and configuration
						</p>
					</div>

					{/* Cloudflare Account & Gateway Selection */}
					<CloudflareAccountSelector />

					{/* Cost Dashboard */}
					<Card id="admin-costs">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<DollarSign className="h-5 w-5" />
								<div>
									<CardTitle>Cost Dashboard</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4 px-6 mt-4">
							{/* Period selector */}
							<div className="flex gap-2">
								{(['24h', '7d', '30d', 'all'] as const).map((p) => (
									<Button
										key={p}
										size="sm"
										variant={costPeriod === p ? 'default' : 'outline'}
										onClick={() => setCostPeriod(p)}
										className={costPeriod === p ? 'bg-accent text-black hover:bg-accent/90' : ''}
									>
										{p === 'all' ? 'All time' : p}
									</Button>
								))}
							</div>

							{/* AI Gateway actual spend */}
							<div className="rounded-lg border border-bg-4 bg-bg-2/30 p-4 space-y-3">
								<p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">AI Gateway — actual provider spend</p>
								{gatewayLoading ? (
									<div className="flex items-center gap-2">
										<Settings className="h-4 w-4 animate-spin text-text-tertiary" />
										<span className="text-sm text-text-tertiary">Loading...</span>
									</div>
								) : gatewayError ? (
									<p className="text-sm text-text-tertiary">{gatewayError}</p>
								) : gatewayData ? (
									<>
										<div className="flex flex-wrap gap-6">
											<div>
												<p className="text-2xl font-bold text-accent">${gatewayData.totalCostUsd.toFixed(2)}</p>
												<p className="text-xs text-text-tertiary mt-0.5">total cost (USD)</p>
											</div>
											<div>
												<p className="text-2xl font-bold text-text-primary">{gatewayData.totalRequests.toLocaleString()}</p>
												<p className="text-xs text-text-tertiary mt-0.5">AI requests</p>
											</div>
											<div>
												<p className="text-lg font-semibold text-text-primary">
													{((gatewayData.tokensIn + gatewayData.tokensOut) / 1000).toFixed(1)}k
												</p>
												<p className="text-xs text-text-tertiary mt-0.5">tokens ({(gatewayData.tokensIn / 1000).toFixed(1)}k in / {(gatewayData.tokensOut / 1000).toFixed(1)}k out)</p>
											</div>
											<div>
												<p className="text-lg font-semibold text-text-primary">{gatewayData.cacheHitRate.toFixed(1)}%</p>
												<p className="text-xs text-text-tertiary mt-0.5">cache hit rate</p>
											</div>
										</div>
										{costPeriod === 'all' && (
											<p className="text-xs text-text-tertiary">Note: AI Gateway data is limited to the last 30 days.</p>
										)}
									</>
								) : (
									<p className="text-sm text-text-tertiary">No gateway data available</p>
								)}
							</div>

							{/* MiniMax direct costs */}
							<div className="rounded-lg border border-bg-4 bg-bg-2/30 p-4 space-y-3">
								<p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">MiniMax — direct subscription spend (estimated)</p>
								{gatewayLoading ? (
									<div className="flex items-center gap-2">
										<Settings className="h-4 w-4 animate-spin text-text-tertiary" />
										<span className="text-sm text-text-tertiary">Loading...</span>
									</div>
								) : gatewayData?.minimax ? (
									<div className="flex flex-wrap gap-6">
										<div>
											<p className="text-2xl font-bold text-accent">${gatewayData.minimax.costUsd.toFixed(4)}</p>
											<p className="text-xs text-text-tertiary mt-0.5">estimated cost (USD)</p>
										</div>
										<div>
											<p className="text-2xl font-bold text-text-primary">{gatewayData.minimax.requests.toLocaleString()}</p>
											<p className="text-xs text-text-tertiary mt-0.5">API calls</p>
										</div>
										<div>
											<p className="text-lg font-semibold text-text-primary">
												{((gatewayData.minimax.tokensIn + gatewayData.minimax.tokensOut) / 1000).toFixed(1)}k
											</p>
											<p className="text-xs text-text-tertiary mt-0.5">tokens ({(gatewayData.minimax.tokensIn / 1000).toFixed(1)}k in / {(gatewayData.minimax.tokensOut / 1000).toFixed(1)}k out)</p>
										</div>
									</div>
								) : (
									<p className="text-sm text-text-tertiary">No MiniMax usage recorded yet in this period</p>
								)}
							</div>

							{/* External service links */}
							<div className="rounded-lg border border-bg-4 bg-bg-2/30 p-4 space-y-2">
								<p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">External billing dashboards</p>
								<div className="flex flex-wrap gap-2 pt-1">
									<a
										href="https://console.cloud.google.com/billing/010E8E-3C84E8-50FA9C/overview"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-bg-4 bg-bg-3 text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
									>
										<ExternalLink className="h-3 w-3" />
										Google Cloud Billing
									</a>
									<a
										href="https://dash.cloudflare.com/12e1ea44f5e3c2904bfbc750fc716e0e/billing"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-bg-4 bg-bg-3 text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
									>
										<ExternalLink className="h-3 w-3" />
										Cloudflare Billing
									</a>
									<a
										href="https://app.sendgrid.com/settings/billing"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-bg-4 bg-bg-3 text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
									>
										<ExternalLink className="h-3 w-3" />
										SendGrid Billing
									</a>
									<a
										href="https://www.minimax.io/"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-bg-4 bg-bg-3 text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
									>
										<ExternalLink className="h-3 w-3" />
										MiniMax Billing
									</a>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* User Management */}
					<Card id="admin-users">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<Users className="h-5 w-5" />
								<div>
									<CardTitle>User Management</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4 px-6 mt-4">
							{/* Filters */}
							<div className="flex gap-3 items-center">
								<Input
									placeholder="Search by email or name..."
									value={userSearch}
									onChange={(e) => handleUserSearch(e.target.value)}
									className="max-w-xs"
								/>
								<div className="flex gap-1">
									{(['all', 'active', 'suspended'] as const).map((s) => (
										<Button
											key={s}
											size="sm"
											variant={userStatus === s ? 'default' : 'outline'}
											onClick={() => handleUserStatusFilter(s)}
											className={userStatus === s ? 'bg-accent text-black hover:bg-accent/90 capitalize' : 'capitalize'}
										>
											{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
										</Button>
									))}
								</div>
							</div>

							{usersLoading ? (
								<div className="flex items-center gap-3 py-4">
									<Settings className="h-5 w-5 animate-spin text-text-tertiary" />
									<span className="text-sm text-text-tertiary">Loading users...</span>
								</div>
							) : usersData && usersData.users.length > 0 ? (
								<>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Email</TableHead>
												<TableHead>Name</TableHead>
												<TableHead>Provider</TableHead>
												<TableHead>Signed up</TableHead>
												<TableHead>Last active</TableHead>
												<TableHead className="text-right">Apps</TableHead>
												<TableHead className="text-right">Credits</TableHead>
												<TableHead>Status</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{usersData.users.map((u: AdminUserEntry) => {
												const isSuspending = actionLoading[`${u.id}:suspend`] ?? false;
												const isUnsuspending = actionLoading[`${u.id}:unsuspend`] ?? false;
												const isUpgrading = actionLoading[`${u.id}:upgrade`] ?? false;
												const isDowngrading = actionLoading[`${u.id}:downgrade`] ?? false;
												const hasOverride = kvOverrides[u.id] ?? false;
												return (
													<TableRow key={u.id}>
														<TableCell className="text-xs font-mono">{u.email}</TableCell>
														<TableCell className="text-sm">{u.displayName}</TableCell>
														<TableCell className="text-sm capitalize text-text-secondary">{u.provider}</TableCell>
														<TableCell className="text-sm text-text-secondary">
															{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
														</TableCell>
														<TableCell className="text-sm text-text-secondary">
															{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : '—'}
														</TableCell>
														<TableCell className="text-right text-sm">{u.appCount}</TableCell>
														<TableCell className="text-right text-sm">{u.totalCredits.toFixed(1)}</TableCell>
														<TableCell>
															<div className="flex items-center gap-1">
																{u.isSuspended ? (
																	<Badge variant="destructive" className="text-xs">Suspended</Badge>
																) : (
																	<Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 text-xs">Active</Badge>
																)}
																{hasOverride && (
																	<Badge variant="secondary" className="bg-accent/20 text-accent text-xs">Pro</Badge>
																)}
															</div>
														</TableCell>
														<TableCell className="text-right">
															<div className="flex gap-1 justify-end">
																{u.isSuspended ? (
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={isUnsuspending}
																		onClick={() => handleUserAction(u.id, 'unsuspend')}
																		className="text-xs"
																	>
																		{isUnsuspending ? 'Working...' : 'Unsuspend'}
																	</Button>
																) : (
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={isSuspending}
																		onClick={() => handleUserAction(u.id, 'suspend')}
																		className="text-xs text-destructive hover:text-destructive"
																	>
																		{isSuspending ? 'Working...' : 'Suspend'}
																	</Button>
																)}
																{hasOverride ? (
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={isDowngrading}
																		onClick={() => handleUserAction(u.id, 'downgrade')}
																		className="text-xs"
																	>
																		{isDowngrading ? 'Working...' : 'Downgrade'}
																	</Button>
																) : (
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={isUpgrading}
																		onClick={() => handleUserAction(u.id, 'upgrade')}
																		className="text-xs text-accent hover:text-accent"
																	>
																		{isUpgrading ? 'Working...' : 'Upgrade'}
																	</Button>
																)}
															</div>
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>

									{/* Pagination */}
									<div className="flex items-center justify-between pt-2">
										<p className="text-sm text-text-tertiary">
											{usersData.total} user{usersData.total !== 1 ? 's' : ''} total
										</p>
										<div className="flex gap-2">
											<Button
												size="sm"
												variant="outline"
												disabled={userPage <= 1 || usersLoading}
												onClick={() => {
													const newPage = userPage - 1;
													setUserPage(newPage);
													loadUsers(userSearch, userStatus, newPage);
												}}
											>
												Prev
											</Button>
											<span className="text-sm text-text-secondary flex items-center px-2">
												Page {userPage}
											</span>
											<Button
												size="sm"
												variant="outline"
												disabled={!usersData.hasMore || usersLoading}
												onClick={() => {
													const newPage = userPage + 1;
													setUserPage(newPage);
													loadUsers(userSearch, userStatus, newPage);
												}}
											>
												Next
											</Button>
										</div>
									</div>
								</>
							) : (
								<div className="rounded-lg border border-dashed border-bg-4 bg-bg-2/50 p-6 text-center">
									<p className="text-sm text-text-tertiary">No users found</p>
								</div>
							)}
						</CardContent>
					</Card>

					{/* AI Model Configurations */}
					<Card id="model-configs">
						<CardHeader variant="minimal">
							<div className="flex items-center gap-3 border-b w-full py-3 text-text-primary">
								<Settings className="h-5 w-5" />
								<div>
									<CardTitle>AI Model Configurations</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6 px-6">
							{/* Provider API Keys Integration */}
							<div className="space-y-2 mt-6">
								<h4 className="font-medium">Provider API Keys</h4>
								<p className="text-sm text-text-tertiary">
									AI provider API keys are managed in the "API Keys & Secrets" section of Settings. Configure
									your OpenAI, Anthropic, Google AI, and OpenRouter keys there.
								</p>

								<Link to="/settings#api-keys">
									<Button
										variant="outline"
										size="sm"
										className="gap-2 shrink-0"
									>
										<Key className="h-4 w-4" />
										API Keys
									</Button>
								</Link>
							</div>

							<Separator />

							{/* Model Configuration Tabs */}
							<ModelConfigTabs
								agentConfigs={agentConfigs}
								modelConfigs={modelConfigs}
								defaultConfigs={defaultConfigs}
								loadingConfigs={loadingConfigs}
								onSaveConfig={saveModelConfig}
								onTestConfig={testModelConfig}
								onResetConfig={resetConfigToDefault}
								onResetAllConfigs={resetAllConfigs}
								testingConfig={testingConfig}
								savingConfigs={savingConfigs}
							/>
						</CardContent>
					</Card>
				</div>
			</main>
		</div>
	);
}
