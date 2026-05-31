import { QRCodeSVG } from 'qrcode.react';
import { Info } from 'lucide-react';

interface ExpoTestPanelProps {
    previewUrl?: string;
    expoTunnelUrl?: string;
}

/**
 * Side panel shown next to the iPhone frame for Expo apps. Renders a QR code the
 * user scans with their phone camera to open the live preview on their device.
 * When a native Expo Go tunnel URL is available it is preferred; otherwise the
 * QR opens the web preview in the phone's mobile browser.
 */
export function ExpoTestPanel({ previewUrl, expoTunnelUrl }: ExpoTestPanelProps) {
    const qrUrl = expoTunnelUrl ?? previewUrl;
    const isNative = !!expoTunnelUrl;

    return (
        <div className="hidden lg:flex flex-col w-72 shrink-0 px-6 py-8 gap-5">
            <div className="flex flex-col gap-1.5">
                <h3 className="text-xl font-semibold text-text-primary">Test on your phone</h3>
                {/* Honest status: only claim native Expo Go when a real tunnel URL exists. */}
                {isNative ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00E676]">
                        <span className="size-1.5 rounded-full bg-[#00E676]" />
                        Expo Go ready — opens the native app
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-tertiary">
                        <span className="size-1.5 rounded-full bg-text-tertiary/50" />
                        Web preview only — native not available yet
                    </span>
                )}
            </div>

            {qrUrl ? (
                <div className="bg-white p-3 rounded-xl w-fit">
                    <QRCodeSVG value={qrUrl} size={200} level="M" />
                </div>
            ) : (
                <div className="w-[224px] h-[224px] bg-bg-2 rounded-xl flex items-center justify-center">
                    <p className="text-xs text-text-tertiary text-center px-6">
                        Waiting for the preview to start…
                    </p>
                </div>
            )}

            {isNative ? (
                <div>
                    <p className="text-sm font-medium text-text-primary mb-2">Run the native app with Expo Go</p>
                    <ol className="text-sm text-text-tertiary space-y-1">
                        <li>1. Open the <span className="text-text-secondary">Expo Go</span> app</li>
                        <li>2. Scan the QR code above</li>
                    </ol>
                </div>
            ) : (
                <div>
                    <p className="text-sm font-medium text-text-primary mb-2">Scan to open the web version</p>
                    <ol className="text-sm text-text-tertiary space-y-1">
                        <li>1. Open the Camera app</li>
                        <li>2. Scan — opens the <span className="text-text-secondary">web</span> preview in your browser</li>
                    </ol>
                </div>
            )}

            <div className="flex gap-2 rounded-lg border border-bg-4 p-3">
                <Info className="size-4 text-text-tertiary shrink-0 mt-0.5" />
                <p className="text-xs text-text-tertiary">
                    {isNative
                        ? 'Runs the real native app on your device via Expo Go.'
                        : 'This QR opens the web build, which lacks native functions and may look different. Native on-device testing isn’t wired up for this preview yet.'}
                </p>
            </div>
        </div>
    );
}
