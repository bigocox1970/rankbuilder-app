import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiClient } from '@/lib/api-client';

/**
 * Redeems an admin-issued one-time impersonation token (?token=...) and logs the
 * browser in as the target user, then sends them to the home page. Intended to be
 * opened in an incognito/separate window so the admin's own session is preserved.
 */
export default function ImpersonatePage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';
    const [error, setError] = useState<string | null>(null);
    const ranRef = useRef(false);

    useEffect(() => {
        if (ranRef.current) return;
        ranRef.current = true;

        if (!token) {
            setError('Missing impersonation token.');
            return;
        }
        (async () => {
            try {
                const result = await apiClient.impersonate(token);
                if (result.success) {
                    // Hard navigation so the new session cookie is picked up everywhere.
                    window.location.href = '/';
                } else {
                    setError(
                        typeof result.error === 'string'
                            ? result.error
                            : 'This link is invalid or has expired.',
                    );
                }
            } catch {
                setError('Something went wrong redeeming this link.');
            }
        })();
    }, [token]);

    return (
        <div className="min-h-screen bg-bg-1 flex items-center justify-center p-4">
            <div className="text-center space-y-3">
                {error ? (
                    <p className="text-text-tertiary">{error}</p>
                ) : (
                    <p className="text-text-tertiary">Signing you in…</p>
                )}
            </div>
        </div>
    );
}
