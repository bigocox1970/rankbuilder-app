import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, CheckCircle, Loader2, AlertCircle, Check } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { SiteContentPlan } from '@/api-types';
import { COLOR_PACKS, FONT_PACKS } from '../../shared/constants/designPacks';

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
    'Choosing your design style...',
    'Writing your headlines...',
    'Designing your service list...',
    'Crafting image briefs...',
    'Finalising your plan...',
];

// ---------------------------------------------------------------------------
// Color swatch icon — 2×2 rounded square matching the reference design
// ---------------------------------------------------------------------------

function SwatchIcon({ pack }: { pack: typeof COLOR_PACKS[number] }) {
    const { light: l, dark: d } = pack;
    return (
        <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex flex-wrap">
            <div style={{ width: 24, height: 24, background: l.primary }} />
            <div style={{ width: 24, height: 24, background: l.background }} />
            <div style={{ width: 24, height: 24, background: d.background }} />
            <div style={{ width: 24, height: 24, background: d.primary }} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Color picker
// ---------------------------------------------------------------------------

interface ColorPickerProps {
    selected: string;
    onChange: (id: string) => void;
}

function ColorPicker({ selected, onChange }: ColorPickerProps) {
    return (
        <div className="flex flex-col gap-0.5">
            {COLOR_PACKS.map((pack) => {
                const isSelected = selected === pack.id;
                return (
                    <button
                        key={pack.id}
                        type="button"
                        onClick={() => onChange(pack.id)}
                        className={[
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors w-full',
                            isSelected
                                ? 'bg-blue-50 border border-blue-300'
                                : 'hover:bg-bg-2/60 border border-transparent',
                        ].join(' ')}
                    >
                        <SwatchIcon pack={pack} />
                        <div className="flex-1 min-w-0">
                            <p className={['text-sm font-semibold', isSelected ? 'text-blue-900' : 'text-text-primary'].join(' ')}>
                                {pack.name}
                            </p>
                            <p className={['text-[10px] font-medium uppercase tracking-widest mt-0.5', isSelected ? 'text-blue-500' : 'text-text-tertiary'].join(' ')}>
                                Inspired by {pack.brand}
                            </p>
                        </div>
                        <div className={[
                            'w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-colors',
                            isSelected ? 'bg-blue-500 border-blue-500' : 'border-border',
                        ].join(' ')}>
                            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Font picker — live preview of the heading font
// ---------------------------------------------------------------------------

interface FontPickerProps {
    selected: string;
    onChange: (id: string) => void;
}

function FontPicker({ selected, onChange }: FontPickerProps) {
    return (
        <div className="flex flex-col gap-0.5">
            {/* Load all heading fonts upfront so inline fontFamily previews render */}
            {FONT_PACKS.map((pack) => (
                <link
                    key={`gf-${pack.id}`}
                    rel="stylesheet"
                    href={`https://fonts.googleapis.com/css2?family=${pack.heading.family.replace(/ /g, '+')}:wght@${pack.heading.weights.join(';')}&family=${pack.body.family.replace(/ /g, '+')}:wght@${pack.body.weights.join(';')}&display=swap`}
                />
            ))}
            {FONT_PACKS.map((pack) => {
                const isSelected = selected === pack.id;
                return (
                    <button
                        key={pack.id}
                        type="button"
                        onClick={() => onChange(pack.id)}
                        className={[
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors w-full',
                            isSelected
                                ? 'bg-blue-50 border border-blue-300'
                                : 'hover:bg-bg-2/60 border border-transparent',
                        ].join(' ')}
                    >
                        {/* Live heading + body preview */}
                        <div className="flex-1 min-w-0 py-0.5">
                            <p
                                style={{ fontFamily: `'${pack.heading.family}', Georgia, serif`, fontWeight: pack.heading.weights[pack.heading.weights.length - 1] ?? 700 }}
                                className={['text-base leading-tight truncate', isSelected ? 'text-blue-900' : 'text-text-primary'].join(' ')}
                            >
                                {pack.name}
                            </p>
                            <p
                                style={{ fontFamily: `'${pack.body.family}', system-ui, sans-serif`, fontWeight: 400 }}
                                className={['text-xs leading-snug mt-0.5 line-clamp-2', isSelected ? 'text-blue-600' : 'text-text-secondary'].join(' ')}
                            >
                                Clean, modern body text for your site content — readable at any size.
                            </p>
                            <p className={['text-[10px] font-medium uppercase tracking-widest mt-1', isSelected ? 'text-blue-400' : 'text-text-tertiary'].join(' ')}>
                                {pack.heading.family} · {pack.body.family}
                            </p>
                        </div>
                        <div className={[
                            'w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-colors',
                            isSelected ? 'bg-blue-500 border-blue-500' : 'border-border',
                        ].join(' ')}>
                            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Picker section wrapper with collapsible toggle
// ---------------------------------------------------------------------------

type PickerSection = 'color' | 'font' | null;

interface PickerRowProps {
    label: string;
    preview: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

function PickerRow({ label, preview, isOpen, onToggle, children }: PickerRowProps) {
    return (
        <div className="rounded-xl border border-border/50 overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-3 bg-bg-2/60 hover:bg-bg-2/80 transition-colors text-left"
            >
                <span className="text-xs font-medium text-text-tertiary uppercase tracking-widest flex-1">{label}</span>
                {preview}
                <svg className={['w-4 h-4 text-text-tertiary transition-transform', isOpen ? 'rotate-180' : ''].join(' ')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 py-2 max-h-72 overflow-y-auto border-t border-border/30">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Loading step
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Review step
// ---------------------------------------------------------------------------

interface ReviewStepProps {
    plan: SiteContentPlan;
    services: string[];
    selectedTheme: string;
    selectedFont: string;
    selectedPageStructure: 'single' | 'multi';
    onServiceChange: (index: number, value: string) => void;
    onThemeChange: (id: string) => void;
    onFontChange: (id: string) => void;
    onPageStructureChange: (v: 'single' | 'multi') => void;
    onApprove: () => void;
    onBack: () => void;
}

function ReviewStep({
    plan, services, selectedTheme, selectedFont, selectedPageStructure,
    onServiceChange, onThemeChange, onFontChange, onPageStructureChange, onApprove, onBack,
}: ReviewStepProps) {
    const [openSection, setOpenSection] = useState<PickerSection>(null);
    const toggleSection = (section: PickerSection) =>
        setOpenSection(prev => (prev === section ? null : section));

    const colorPack = COLOR_PACKS.find(p => p.id === selectedTheme) ?? COLOR_PACKS[0];
    const fontPack = FONT_PACKS.find(p => p.id === selectedFont) ?? FONT_PACKS[0];

    return (
        <div className="flex flex-col gap-4">
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
                {(plan.realData?.images?.length || plan.realData?.reviews?.length || plan.realData?.facts) ? (
                    <p className="text-xs text-text-tertiary">
                        Using your real data:
                        {plan.realData?.images?.length ? <span className="text-text-secondary"> {plan.realData.images.length} photo{plan.realData.images.length === 1 ? '' : 's'}</span> : null}
                        {plan.realData?.reviews?.length ? <span className="text-text-secondary"> · {plan.realData.reviews.length} verified review{plan.realData.reviews.length === 1 ? '' : 's'}</span> : null}
                        {plan.realData?.facts?.rating ? <span className="text-text-secondary"> · rated {plan.realData.facts.rating}</span> : null}
                        {plan.realData?.facts?.phone ? <span className="text-text-secondary"> · {plan.realData.facts.phone}</span> : null}
                    </p>
                ) : null}
            </div>

            {/* Page structure */}
            <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-tertiary uppercase tracking-widest">Page structure</p>
                <div className="grid grid-cols-2 gap-2">
                    {(['single', 'multi'] as const).map((type) => {
                        const isSelected = selectedPageStructure === type;
                        return (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onPageStructureChange(type)}
                                className={[
                                    'flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl border text-left transition-colors',
                                    isSelected ? 'bg-blue-50 border-blue-300' : 'border-border/50 hover:bg-bg-2/60',
                                ].join(' ')}
                            >
                                <span className={['text-sm font-semibold', isSelected ? 'text-blue-900' : 'text-text-primary'].join(' ')}>
                                    {type === 'single' ? 'Single page' : 'Multi-page'}
                                </span>
                                <span className={['text-[10px] leading-snug', isSelected ? 'text-blue-500' : 'text-text-tertiary'].join(' ')}>
                                    {type === 'single'
                                        ? 'One page, anchor links — fast to build'
                                        : 'Separate pages per service — maximum SEO'}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Design pickers */}
            <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-tertiary uppercase tracking-widest">Design</p>

                {/* Color theme */}
                <PickerRow
                    label="Colour"
                    isOpen={openSection === 'color'}
                    onToggle={() => toggleSection('color')}
                    preview={
                        <div className="flex items-center gap-2">
                            <SwatchIcon pack={colorPack} />
                            <div className="text-right">
                                <p className="text-xs font-semibold text-text-primary">{colorPack.name}</p>
                                <p className="text-[10px] text-text-tertiary uppercase tracking-widest">Inspired by {colorPack.brand}</p>
                            </div>
                        </div>
                    }
                >
                    <ColorPicker selected={selectedTheme} onChange={(id) => { onThemeChange(id); setOpenSection(null); }} />
                </PickerRow>

                {/* Font */}
                <PickerRow
                    label="Font"
                    isOpen={openSection === 'font'}
                    onToggle={() => toggleSection('font')}
                    preview={
                        <div className="flex items-center gap-2">
                            <div className="text-right">
                                <p style={{ fontFamily: `'${fontPack.heading.family}', Georgia, serif`, fontWeight: fontPack.heading.weights[fontPack.heading.weights.length - 1] }} className="text-sm text-text-primary leading-tight">
                                    {fontPack.name}
                                </p>
                                <p style={{ fontFamily: `'${fontPack.body.family}', system-ui, sans-serif` }} className="text-[10px] text-text-tertiary">
                                    {fontPack.heading.family}
                                </p>
                            </div>
                        </div>
                    }
                >
                    <FontPicker selected={selectedFont} onChange={(id) => { onFontChange(id); setOpenSection(null); }} />
                </PickerRow>

            </div>

            {/* Services */}
            <div>
                <p className="text-xs font-medium text-text-tertiary uppercase tracking-widest mb-3">
                    Your 6 services — edit if needed
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SitePlanner({ description, keywords, onApprove, onBack }: Props) {
    const [step, setStep] = useState<PlannerStep>('loading');
    const [plan, setPlan] = useState<SiteContentPlan | null>(null);
    const [services, setServices] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedTheme, setSelectedTheme] = useState<string>('ledger');
    const [selectedFont, setSelectedFont] = useState<string>('courthouse');
    const [selectedWireframe, setSelectedWireframe] = useState<string>('service-local');
    const [selectedPageStructure, setSelectedPageStructure] = useState<'single' | 'multi'>('single');

    const fetchPlan = useCallback(async () => {
        setStep('loading');
        setError(null);
        try {
            const fetched = await apiClient.generateSitePlan(description, keywords);
            setPlan(fetched);
            setServices(fetched.services.slice(0, 6).map(s => s.title));
            setSelectedTheme(fetched.theme ?? 'ledger');
            setSelectedFont(fetched.font ?? 'courthouse');
            setSelectedWireframe(fetched.wireframe ?? 'service-local');
            setSelectedPageStructure(fetched.pageStructure ?? 'single');
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
            theme: selectedTheme as SiteContentPlan['theme'],
            font: selectedFont as SiteContentPlan['font'],
            wireframe: selectedWireframe,
            pageStructure: selectedPageStructure,
            services: services.map((title, i) => ({
                ...(plan.services[i] ?? { description: '', imagePrompt: '' }),
                title,
            })),
        };
        onApprove(finalPlan);
    }, [plan, services, selectedTheme, selectedFont, selectedWireframe, selectedPageStructure, onApprove]);

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
                            selectedTheme={selectedTheme}
                            selectedFont={selectedFont}
                            selectedPageStructure={selectedPageStructure}
                            onServiceChange={(i, v) => setServices(prev => prev.map((s, idx) => idx === i ? v : s))}
                            onThemeChange={setSelectedTheme}
                            onFontChange={setSelectedFont}
                            onPageStructureChange={setSelectedPageStructure}
                            onApprove={handleApprove}
                            onBack={onBack}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
