import { useState, useRef } from 'react';

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
    const menuRef = useRef<HTMLDivElement>(null);

    const slots = Object.entries(images).filter(([, url]) => url && !url.includes('/undefined/'));

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
                        title={`${SLOT_LABELS[slot] ?? slot} - right-click or drag to use`}
                    >
                        <img
                            src={url}
                            alt={SLOT_LABELS[slot] ?? slot}
                            className="h-14 w-auto rounded object-cover border border-zinc-700 group-hover:border-zinc-500 transition-colors cursor-grab active:cursor-grabbing"
                            crossOrigin="anonymous"
                        />
                        <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-zinc-400 bg-black/60 rounded-b px-1 py-0.5 leading-tight">
                            {SLOT_LABELS[slot] ?? slot}
                        </span>
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
        </>
    );
}
