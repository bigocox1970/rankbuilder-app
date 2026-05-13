import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') ?? '';

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.resetPassword(token, newPassword, confirmPassword);
            if (result.success) {
                setSuccess(true);
            } else {
                setError(typeof result.error === 'string' ? result.error : 'Failed to reset password. The link may have expired.');
            }
        } catch {
            setError('Something went wrong. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="min-h-screen bg-bg-1 flex items-center justify-center p-4">
                <div className="text-center space-y-3">
                    <p className="text-text-tertiary">Invalid reset link.</p>
                    <button onClick={() => navigate('/')} className="text-accent hover:underline text-sm">
                        Go home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-bg-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-bg-3 border border-border-primary/50 rounded-2xl p-8 shadow-xl">
                <div className="mb-6 text-center">
                    <a href="https://rankbuilder.app" className="inline-flex items-center gap-2 mb-6 no-underline">
                        <span className="font-bold text-lg text-text-primary">
                            Rank<span style={{ color: '#00E676' }}>Builder</span>
                        </span>
                    </a>
                    <h1 className="text-2xl font-semibold text-text-primary">Choose a new password</h1>
                </div>

                {success ? (
                    <div className="text-center space-y-4">
                        <CheckCircle2 className="size-12 text-accent mx-auto" />
                        <p className="text-text-secondary">Password reset successfully.</p>
                        <button
                            onClick={() => navigate('/')}
                            className="w-full bg-accent text-bg-1 p-3 rounded-lg font-medium hover:bg-accent/90 transition-colors"
                        >
                            Sign in
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                                {error}
                            </p>
                        )}
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                placeholder="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full p-3 pr-10 rounded-lg border border-border bg-background text-text-primary transition-colors focus:border-accent outline-none"
                                disabled={isLoading}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        <input
                            type="password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full p-3 rounded-lg border border-border bg-background text-text-primary transition-colors focus:border-accent outline-none"
                            disabled={isLoading}
                            required
                        />
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-accent text-bg-1 p-3 rounded-lg font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            {isLoading ? 'Resetting...' : 'Reset password'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
