import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
    images: Record<string, string>;
    onInsertUrl?: (url: string) => void;
}

const SLOT_LABELS: Record<string, string> = {
    hero: 'Hero',
    work1: 'Work 1',
    work2: 'Work 2',
};

export function GeneratedImageThumbnails({ images, onInsertUrl }: Props) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
    const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const menuRef = useRef<HTMLDivElement>(null);

    const slots = Object.entries(images).filter(([slot, url]) => url && !url.includes('/undefined/') && !dismissed.has(slot));

    if (slots.length === 0) return null;

    const handleContextMenu = (e: React.MouseEvent, url: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, url });
    };

    const handleCopy = async (url: string) => {
        await navigator.clipboard.writeText(url);
        setContextMenu(null);
    };

    const handleInsert = (url: string) => {
        onInsertUrl?.(url);
        setContextMenu(null);
    };

    return (
        <>
            <div className="flex gap-2 px-3 py-2 border-t border-zinc-800 overflow-x-auto">
                {slots.map(([slot, url]) => (
                    <div
                        key={slot}
                        className="flex-shrink-0 group relative"
                        onContextMenu={(e) => handleContextMenu(e, url)}
                        draggable
                        onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', url);
                            e.dataTransfer.setData('text/uri-list', url);
                        }}
                        title={`${SLOT_LABELS[slot] ?? slot} - click to enlarge, right-click or drag to use`}
                    >
                        <img
                            src={url}
                            alt={SLOT_LABELS[slot] ?? slot}
                            className="h-14 w-auto rounded object-cover border border-zinc-700 group-hover:border-zinc-500 transition-colors cursor-pointer"
                            crossOrigin="anonymous"
                            onClick={() => setLightbox({ url, label: SLOT_LABELS[slot] ?? slot })}
                        />
                        <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-zinc-400 bg-black/60 rounded-b px-1 py-0.5 leading-tight">
                            {SLOT_LABELS[slot] ?? slot}
                        </span>
                        <button
                            className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-zinc-700 hover:bg-zinc-500 text-zinc-300 hover:text-white text-[10px] leading-none transition-colors"
                            onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set([...prev, slot])); }}
                            title="Dismiss"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            {contextMenu && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setContextMenu(null)}
                    />
                    <div
                        ref={menuRef}
                        className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg py-1 text-sm"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <button
                            className="w-full text-left px-4 py-1.5 hover:bg-zinc-800 text-zinc-200"
                            onClick={() => handleCopy(contextMenu.url)}
                        >
                            Copy URL
                        </button>
                        {onInsertUrl && (
                            <button
                                className="w-full text-left px-4 py-1.5 hover:bg-zinc-800 text-zinc-200"
                                onClick={() => handleInsert(contextMenu.url)}
                            >
                                Insert into chat
                            </button>
                        )}
                    </div>
                </>
            )}

            {lightbox && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
                    onClick={() => setLightbox(null)}
                >
                    <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                        <img
                            src={lightbox.url}
                            alt={lightbox.label}
                            className="max-w-full max-h-[85vh] rounded-lg object-contain shadow-2xl"
                            crossOrigin="anonymous"
                        />
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/60 rounded-b-lg px-4 py-2">
                            <span className="text-sm text-zinc-300">{lightbox.label}</span>
                            <button
                                className="text-xs text-zinc-400 hover:text-white transition-colors"
                                onClick={() => setLightbox(null)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
