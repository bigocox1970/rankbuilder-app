import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { Database, Loader2, CheckCircle, ExternalLink, Unlink, RefreshCw, Plus, ArrowLeft } from 'lucide-react';
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
import type { SupabaseStatusData, SupabaseProject, SupabaseProjectLinkInfo } from '@/api-types';

interface SupabaseConnectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStatusChange?: (status: SupabaseStatusData) => void;
}

type ModalView = 'loading' | 'disconnected' | 'picking' | 'creating' | 'connected';

const REGIONS = [
    { value: 'us-east-1', label: 'US East (N. Virginia)' },
    { value: 'us-west-1', label: 'US West (N. California)' },
    { value: 'eu-west-1', label: 'EU West (Ireland)' },
    { value: 'eu-central-1', label: 'EU Central (Frankfurt)' },
    { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
    { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
    { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
];

export function SupabaseConnectModal({ open, onOpenChange, onStatusChange }: SupabaseConnectModalProps) {
    const { chatId } = useParams();
    const [view, setView] = useState<ModalView>('loading');
    const [status, setStatus] = useState<SupabaseStatusData | null>(null);
    const [projects, setProjects] = useState<SupabaseProject[]>([]);
    const [links, setLinks] = useState<SupabaseProjectLinkInfo[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [linkingRef, setLinkingRef] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Create project form
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectRegion, setNewProjectRegion] = useState('us-east-1');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!open) return;
        loadStatus();
    }, [open]);

    async function loadStatus() {
        setView('loading');
        setError(null);
        const resp = await apiClient.getSupabaseStatus(chatId);
        if (!resp.success || !resp.data) {
            setView('disconnected');
            return;
        }
        setStatus(resp.data);
        onStatusChange?.(resp.data);
        if (!resp.data.connected) {
            setView('disconnected');
        } else if (resp.data.linkedProject) {
            setView('connected');
        } else {
            setView('picking');
            loadProjects();
        }
    }

    async function loadProjects() {
        setLoadingProjects(true);
        setError(null);
        const resp = await apiClient.listSupabaseProjects();
        if (resp.success && resp.data) {
            setProjects(resp.data.projects);
            setLinks(resp.data.links ?? []);
        } else {
            setError('Could not load your Supabase projects. Try disconnecting and reconnecting.');
        }
        setLoadingProjects(false);
    }

    function handleConnect() {
        window.location.href = `/api/integrations/supabase/connect?return_url=${encodeURIComponent(window.location.href)}`;
    }

    async function handleLinkProject(ref: string) {
        if (!chatId) { setError('No app context — open this from inside an app.'); return; }
        setLinkingRef(ref);
        setError(null);
        const resp = await apiClient.linkSupabaseProject(ref, chatId);
        if (!resp.success) {
            setError('Failed to link project. Please try again.');
            setLinkingRef(null);
            return;
        }
        await loadStatus();
        setLinkingRef(null);
    }

    const CREATE_LIMIT_MSG = "Creating a new Supabase project isn't available here — Supabase needs extra permissions for that. Create the project in your Supabase dashboard, then come back and link it (the picker on the previous screen).";

    async function handleCreateProject() {
        if (!newProjectName.trim()) return;
        setCreating(true);
        setError(null);
        try {
            const resp = await apiClient.createSupabaseProject(newProjectName.trim(), newProjectRegion);
            if (!resp.success) {
                const m = resp.error?.message ?? '';
                setError(/403|forbidden|organization|permission|write/i.test(m) ? CREATE_LIMIT_MSG : (m || 'Could not create the project.'));
                return;
            }
            // Project created — link it (or fall back to the picker to select the new one).
            if (resp.data?.ref) {
                await handleLinkProject(resp.data.ref);
            } else {
                setView('picking');
                await loadProjects();
            }
            setNewProjectName('');
        } catch (e) {
            // api-client throws on non-2xx — the create endpoint 403s when the connection
            // lacks org/write scope. Show the friendly limit message instead of crashing.
            const m = e instanceof Error ? e.message : '';
            setError(/403|forbidden|organization|permission|write/i.test(m) ? CREATE_LIMIT_MSG : 'Could not create the project. Create it in your Supabase dashboard, then link it here.');
        } finally {
            setCreating(false);
        }
    }

    async function handleDisconnect() {
        setDisconnecting(true);
        // Unlink this app's DB only (the user's Supabase OAuth account stays connected so
        // they can link a different project here or in other apps without re-auth).
        await apiClient.disconnectSupabase(chatId);
        // Clear this app's linked indicator immediately, then refresh: still OAuth-connected
        // with no project → the picker, so they can choose a new DB for this app.
        onStatusChange?.({ connected: true, linkedProject: null });
        setDisconnecting(false);
        await loadStatus();
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-bg-1 border-bg-4">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-text-primary">
                        <Database className="h-5 w-5 text-[#3ECF8E]" />
                        Supabase
                    </DialogTitle>
                    <DialogDescription className="text-text-tertiary">
                        {view === 'disconnected' && 'Connect your Supabase account to use your database in builds.'}
                        {view === 'picking' && 'Pick a project to link, or create a new one.'}
                        {view === 'creating' && 'Create a new Supabase project.'}
                        {view === 'connected' && 'Your Supabase project is linked to this app.'}
                        {view === 'loading' && 'Loading…'}
                    </DialogDescription>
                </DialogHeader>

                {view === 'loading' && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
                    </div>
                )}

                {view === 'disconnected' && (
                    <div className="space-y-4">
                        <p className="text-sm text-text-secondary">
                            Sign in with Supabase OAuth. Once connected, you can pick an existing project or create a new one — all without leaving this page.
                        </p>
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        <Button onClick={handleConnect} className="w-full bg-[#3ECF8E] hover:bg-[#38b87e] text-black font-semibold">
                            Connect Supabase
                        </Button>
                        <a
                            href="https://supabase.com/dashboard"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Open Supabase dashboard
                        </a>
                    </div>
                )}

                {view === 'picking' && (
                    <div className="space-y-3">
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        {loadingProjects ? (
                            <div className="flex items-center gap-2 py-4">
                                <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                                <span className="text-sm text-text-tertiary">Loading your projects…</span>
                            </div>
                        ) : (
                            <>
                                {projects.length > 0 && (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                        {projects.map(p => {
                                            const linkedApps = links.filter(l => l.projectRef === p.ref);
                                            return (
                                            <button
                                                key={p.ref}
                                                onClick={() => handleLinkProject(p.ref)}
                                                disabled={linkingRef !== null}
                                                className="w-full flex items-center justify-between p-3 rounded-lg border border-bg-4 bg-bg-2/50 hover:bg-bg-3/50 hover:border-[#3ECF8E]/40 transition-colors text-left disabled:opacity-50"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                                                    <p className="text-xs text-text-tertiary">{p.region}</p>
                                                    {linkedApps.length > 0 && (
                                                        <p className="text-[11px] text-[#3ECF8E] mt-0.5 truncate">
                                                            Linked to {linkedApps.map(l => l.appTitle?.trim() || 'an app').join(', ')}
                                                        </p>
                                                    )}
                                                </div>
                                                {linkingRef === p.ref ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary shrink-0" />
                                                ) : (
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${p.status === 'ACTIVE_HEALTHY' ? 'border-[#3ECF8E]/40 text-[#3ECF8E] bg-[#3ECF8E]/10' : 'border-bg-4 text-text-tertiary'}`}>
                                                        {p.status === 'ACTIVE_HEALTHY' ? 'active' : p.status.toLowerCase().replace(/_/g, ' ')}
                                                    </span>
                                                )}
                                            </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Create new project */}
                                <button
                                    onClick={() => setView('creating')}
                                    disabled={linkingRef !== null}
                                    className="w-full flex items-center gap-2 p-3 rounded-lg border border-dashed border-bg-4 hover:border-[#3ECF8E]/40 hover:bg-[#3ECF8E]/5 transition-colors text-left disabled:opacity-50"
                                >
                                    <Plus className="h-4 w-4 text-text-tertiary shrink-0" />
                                    <span className="text-sm text-text-tertiary">Create a new project</span>
                                </button>
                            </>
                        )}

                        <div className="flex gap-2 pt-1">
                            <Button variant="outline" size="sm" onClick={loadProjects} disabled={loadingProjects} className="gap-1.5">
                                <RefreshCw className="h-3.5 w-3.5" />
                                Refresh
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5 text-text-tertiary hover:text-red-400 ml-auto">
                                <Unlink className="h-3.5 w-3.5" />
                                Disconnect
                            </Button>
                        </div>
                    </div>
                )}

                {view === 'creating' && (
                    <div className="space-y-4">
                        <button onClick={() => setView('picking')} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors">
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to projects
                        </button>
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-text-tertiary mb-1.5 block">Project name</label>
                                <Input
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    placeholder="my-app"
                                    className="bg-bg-2 border-bg-4"
                                    disabled={creating}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-text-tertiary mb-1.5 block">Region</label>
                                <select
                                    value={newProjectRegion}
                                    onChange={e => setNewProjectRegion(e.target.value)}
                                    disabled={creating}
                                    className="w-full text-sm rounded-md border border-bg-4 bg-bg-2 px-3 py-2 text-text-primary focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]/40"
                                >
                                    {REGIONS.map(r => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <Button
                            onClick={handleCreateProject}
                            disabled={!newProjectName.trim() || creating}
                            className="w-full bg-[#3ECF8E] hover:bg-[#38b87e] text-black font-semibold"
                        >
                            {creating ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Creating project…
                                </span>
                            ) : 'Create project'}
                        </Button>
                        <p className="text-xs text-text-tertiary">Free tier — takes about 60 seconds to provision.</p>
                    </div>
                )}

                {view === 'connected' && status?.linkedProject && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-[#3ECF8E]/30 bg-[#3ECF8E]/5">
                            <CheckCircle className="h-5 w-5 text-[#3ECF8E] shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">{status.linkedProject.projectName}</p>
                                <p className="text-xs text-text-tertiary truncate">{status.linkedProject.projectUrl}</p>
                            </div>
                        </div>
                        <p className="text-xs text-text-tertiary">
                            New builds will use this project's schema, auth, and storage automatically.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => { setView('picking'); loadProjects(); }} className="flex-1">
                                Change project
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="flex-1 text-text-tertiary hover:text-red-400">
                                {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
