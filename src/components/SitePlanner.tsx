import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { SiteContentPlan } from '@/api-types';

type PlannerStep = 'loading' | 'review' | 'error';

interface Props {
    description: string;
    keywords: string[];
    onApprove: (plan: SiteContentPlan) => void;
    onBack: () => void;
}

const LOADING_MESSAGES = [
    'Analysing your business...',
    'Planning your page content...',
    'Writing your headlines...',
    'Designing your service list...',
    'Crafting image briefs...',
    'Finalising your plan...',
];

function LoadingStep() {
    const [messageIndex, setMessageIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setMessageIndex(i => (i + 1) % LOADING_MESSAGES.length);
        }, 1400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex flex-col items-center gap-6 py-8">
            <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-accent/20 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-accent animate-spin" />
                </div>
                <div
                    className="absolute inset-0 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(0,230,118,0.15) 0%, transparent 70%)' }}
                />
            </div>
            <AnimatePresence mode="wait">
                <motion.p
                    key={messageIndex}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="text-text-secondary text-sm font-medium"
                >
                    {LOADING_MESSAGES[messageIndex]}
                </motion.p>
            </AnimatePresence>
        </div>
    );
}

interface ReviewStepProps {
    plan: SiteContentPlan;
    services: string[];
    onServiceChange: (index: number, value: string) => void;
    onApprove: () => void;
    onBack: () => void;
}

function ReviewStep({ plan, services, onServiceChange, onApprove, onBack }: ReviewStepProps) {
    return (
        <div className="flex flex-col gap-5">
            {/* Brief card */}
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 flex flex-col gap-2">
                <p className="text-xs font-medium text-accent uppercase tracking-widest">Your website brief</p>
                <p className="text-lg font-semibold text-text-primary leading-snug">
                    "{plan.tagline}"
                </p>
                <p className="text-sm text-text-secondary">
                    <span className="font-medium text-text-primary">{plan.hero.headline}</span>
                    {' — '}
                    {plan.hero.subheadline}
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                    Tone: <span className="text-text-secondary capitalize">{plan.tone}</span>
                    {' · '}
                    CTA: <span className="text-text-secondary">"{plan.hero.cta}"</span>
                </p>
            </div>

            {/* Services */}
            <div>
                <p className="text-xs font-medium text-text-tertiary uppercase tracking-widest mb-3">
                    Your 6 services — edit names if needed
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {services.map((name, i) => (
                        <input
                            key={i}
                            value={name}
                            onChange={e => onServiceChange(i, e.target.value)}
                            className="px-3 py-2 rounded-lg border border-border/50 bg-bg-2/60 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors"
                            placeholder={`Service ${i + 1}`}
                        />
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border/50 text-sm text-text-secondary hover:text-text-primary hover:border-border transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Edit brief
                </button>
                <button
                    type="button"
                    onClick={onApprove}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors"
                >
                    <CheckCircle className="w-4 h-4" />
                    Build my website
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export function SitePlanner({ description, keywords, onApprove, onBack }: Props) {
    const [step, setStep] = useState<PlannerStep>('loading');
    const [plan, setPlan] = useState<SiteContentPlan | null>(null);
    const [services, setServices] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const fetchPlan = useCallback(async () => {
        setStep('loading');
        setError(null);
        try {
            const fetched = await apiClient.generateSitePlan(description, keywords);
            setPlan(fetched);
            setServices(fetched.services.slice(0, 6).map(s => s.title));
            setStep('review');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate plan');
            setStep('error');
        }
    }, [description, keywords]);

    useEffect(() => {
        fetchPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleApprove = useCallback(() => {
        if (!plan) return;
        const finalPlan: SiteContentPlan = {
            ...plan,
            services: services.map((title, i) => ({
                ...(plan.services[i] ?? { description: '', imagePrompt: '' }),
                title,
            })),
        };
        onApprove(finalPlan);
    }, [plan, services, onApprove]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="w-full rounded-2xl border border-border/50 bg-bg-2/80 backdrop-blur-sm p-6"
        >
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-text-primary">Planning your website</h2>
                {step === 'review' && (
                    <span className="text-xs text-accent font-medium px-2 py-0.5 rounded-full bg-accent/10">
                        Review &amp; confirm
                    </span>
                )}
            </div>

            <AnimatePresence mode="wait">
                {step === 'loading' && (
                    <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <LoadingStep />
                    </motion.div>
                )}
                {step === 'error' && (
                    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center gap-4 py-6"
                    >
                        <AlertCircle className="w-10 h-10 text-red-400" />
                        <p className="text-sm text-text-secondary text-center">{error}</p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onBack}
                                className="px-4 py-2 rounded-xl border border-border/50 text-sm text-text-secondary hover:text-text-primary transition-colors"
                            >
                                Go back
                            </button>
                            <button
                                type="button"
                                onClick={fetchPlan}
                                className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-sm text-accent hover:bg-accent/20 transition-colors"
                            >
                                Try again
                            </button>
                        </div>
                    </motion.div>
                )}
                {step === 'review' && plan && (
                    <motion.div key="review" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <ReviewStep
                            plan={plan}
                            services={services}
                            onServiceChange={(i, v) => setServices(prev => prev.map((s, idx) => idx === i ? v : s))}
                            onApprove={handleApprove}
                            onBack={onBack}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
