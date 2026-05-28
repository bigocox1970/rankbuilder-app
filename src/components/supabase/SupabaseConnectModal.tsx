import { useState, useEffect } from 'react';
import { Database, Loader2, CheckCircle, ExternalLink, Unlink, RefreshCw } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import type { SupabaseStatusData, SupabaseProject } from '@/api-types';

interface SupabaseConnectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStatusChange?: (status: SupabaseStatusData) => void;
}

type ModalView = 'loading' | 'disconnected' | 'selecting-project' | 'connected';

export function SupabaseConnectModal({ open, onOpenChange, onStatusChange }: SupabaseConnectModalProps) {
    const [view, setView] = useState<ModalView>('loading');
    const [status, setStatus] = useState<SupabaseStatusData | null>(null);
    const [projects, setProjects] = useState<SupabaseProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [linkingRef, setLinkingRef] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        loadStatus();
    }, [open]);

    async function loadStatus() {
        setView('loading');
        setError(null);
        const resp = await apiClient.getSupabaseStatus();
        if (!resp.success || !resp.data) {
            setView('disconnected');
            return;
        }
        setStatus(resp.data);
        onStatusChange?.(resp.data);
        if (!resp.data.connected) {
            setView('disconnected');
        } else if (!resp.data.linkedProject) {
            setView('selecting-project');
            loadProjects();
        } else {
            setView('connected');
        }
    }

    async function loadProjects() {
        setLoadingProjects(true);
        setError(null);
        const resp = await apiClient.listSupabaseProjects();
        if (resp.success && resp.data) {
            setProjects(resp.data.projects);
        } else {
            setError('Could not load your Supabase projects.');
        }
        setLoadingProjects(false);
    }

    function handleConnect() {
        window.location.href = `/api/integrations/supabase/connect?return_url=${encodeURIComponent(window.location.href)}`;
    }

    async function handleLinkProject(ref: string) {
        setLinkingRef(ref);
        setError(null);
        const resp = await apiClient.linkSupabaseProject(ref);
        if (!resp.success) {
            setError('Failed to link project. Please try again.');
            setLinkingRef(null);
            return;
        }
        await loadStatus();
        setLinkingRef(null);
    }

    async function handleDisconnect() {
        setDisconnecting(true);
        await apiClient.disconnectSupabase();
        setStatus(null);
        onStatusChange?.({ connected: false, linkedProject: null });
        setView('disconnected');
        setDisconnecting(false);
    }

    function handleChangeProject() {
        setView('selecting-project');
        loadProjects();
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
                        Connect your Supabase project so built apps can use your database, auth, and storage.
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
                            Sign in to Supabase with OAuth to link a project. Generated apps will be pre-wired with your project URL, anon key, and database schema.
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

                {view === 'selecting-project' && (
                    <div className="space-y-3">
                        <p className="text-sm text-text-secondary">Select a project to link to your builds:</p>
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        {loadingProjects ? (
                            <div className="flex items-center gap-2 py-4">
                                <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                                <span className="text-sm text-text-tertiary">Loading projects...</span>
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="space-y-3">
                                <p className="text-sm text-text-tertiary">No projects found in your Supabase account.</p>
                                <a
                                    href="https://supabase.com/dashboard/new"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-sm text-[#3ECF8E] hover:underline"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Create a new project
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {projects.map(p => (
                                    <button
                                        key={p.ref}
                                        onClick={() => handleLinkProject(p.ref)}
                                        disabled={linkingRef !== null}
                                        className="w-full flex items-center justify-between p-3 rounded-lg border border-bg-4 bg-bg-2/50 hover:bg-bg-3/50 hover:border-[#3ECF8E]/40 transition-colors text-left disabled:opacity-50"
                                    >
                                        <div>
                                            <p className="text-sm font-medium text-text-primary">{p.name}</p>
                                            <p className="text-xs text-text-tertiary">{p.ref} · {p.region}</p>
                                        </div>
                                        {linkingRef === p.ref ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                                        ) : (
                                            <span className={`text-xs px-2 py-0.5 rounded-full border ${p.status === 'ACTIVE_HEALTHY' ? 'border-[#3ECF8E]/40 text-[#3ECF8E] bg-[#3ECF8E]/10' : 'border-bg-4 text-text-tertiary'}`}>
                                                {p.status === 'ACTIVE_HEALTHY' ? 'active' : p.status.toLowerCase()}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2 pt-1">
                            <Button variant="outline" size="sm" onClick={loadProjects} disabled={loadingProjects} className="gap-1.5">
                                <RefreshCw className="h-3.5 w-3.5" />
                                Refresh
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5 text-text-tertiary hover:text-red-400">
                                <Unlink className="h-3.5 w-3.5" />
                                Disconnect
                            </Button>
                        </div>
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
                            New apps you build will be pre-configured with this project's connection details and database schema.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleChangeProject} className="flex-1">
                                Change project
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleDisconnect}
                                disabled={disconnecting}
                                className="flex-1 text-text-tertiary hover:text-red-400"
                            >
                                {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
