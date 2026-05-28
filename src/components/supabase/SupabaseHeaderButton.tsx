import { useState, useEffect } from 'react';
import { Database } from 'lucide-react';
import { SupabaseConnectModal } from './SupabaseConnectModal';
import { apiClient } from '@/lib/api-client';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { SupabaseStatusData } from '@/api-types';

export function SupabaseHeaderButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<SupabaseStatusData | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();

    useEffect(() => {
        apiClient.getSupabaseStatus().then(r => {
            if (r.success && r.data) setStatus(r.data);
        });
    }, []);

    // Auto-open after OAuth callback
    useEffect(() => {
        const param = searchParams.get('supabase');
        if (!param) return;
        const next = new URLSearchParams(searchParams);
        next.delete('supabase');
        next.delete('reason');
        setSearchParams(next, { replace: true });
        if (param === 'connected') {
            setIsOpen(true);
        } else if (param === 'error') {
            const reason = searchParams.get('reason') ?? 'unknown';
            toast.error(`Supabase connection failed: ${reason.replace(/_/g, ' ')}`);
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
                className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm"
            >
                <Database className={`size-4 transition-colors duration-200 ${isLinked ? 'text-[#3ECF8E]' : 'text-text-primary/50 hover:text-accent'}`} />
                <span className={`text-xs font-medium ${isLinked ? 'text-[#3ECF8E]' : 'text-text-primary/50'}`}>Supabase</span>
            </button>
        </>
    );
}
