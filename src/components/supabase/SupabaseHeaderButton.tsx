import { useState, useEffect } from 'react';
import { Database } from 'lucide-react';
import { SupabaseConnectModal } from './SupabaseConnectModal';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import type { SupabaseStatusData } from '@/api-types';

export function SupabaseHeaderButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<SupabaseStatusData | null>(null);

    useEffect(() => {
        apiClient.getSupabaseStatus().then(r => {
            if (r.success && r.data) setStatus(r.data);
        });
    }, []);

    // Handle return from Supabase OAuth on headerless routes (e.g. /chat/).
    // GlobalHeader is suppressed on these routes so it never reads ?supabase=connected.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const param = params.get('supabase');
        if (!param) return;
        const reason = params.get('reason') ?? 'unknown';
        params.delete('supabase');
        params.delete('reason');
        const clean = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (clean ? `?${clean}` : ''));
        if (param === 'connected') {
            setIsOpen(true);
        } else {
            toast.error(`Supabase connection failed: ${reason}`);
        }
    }, []);

    const isLinked = Boolean(status?.linkedProject);

    return (
        <>
            <SupabaseConnectModal
                open={isOpen}
                onOpenChange={setIsOpen}
                onStatusChange={setStatus}
            />
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                title={isLinked ? `Supabase: ${status?.linkedProject?.projectName}` : 'Connect Supabase'}
                className="flex items-center px-1.5 py-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm"
            >
                <Database className={`size-4 transition-colors duration-200 ${isLinked ? 'text-[#3ECF8E]' : 'text-text-primary/50 hover:text-accent'}`} />
            </button>
        </>
    );
}
