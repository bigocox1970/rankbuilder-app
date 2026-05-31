import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';

interface ExpoPhoneButtonProps {
    previewUrl?: string;
    expoTunnelUrl?: string;
}

export function ExpoPhoneButton({ previewUrl, expoTunnelUrl }: ExpoPhoneButtonProps) {
    const [open, setOpen] = useState(false);

    const qrUrl = expoTunnelUrl ?? previewUrl;
    const isNative = !!expoTunnelUrl;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Preview on phone"
                    className="flex items-center px-1.5 py-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm"
                >
                    <Smartphone className="size-4 text-text-primary/50 hover:text-accent transition-colors duration-200" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 bg-bg-1 border-bg-4 p-4" align="end">
                <div className="space-y-3">
                    <div>
                        <p className="text-sm font-medium text-text-primary">Preview on your phone</p>
                        <p className="text-xs text-text-tertiary mt-0.5">
                            {isNative
                                ? <>Open <span className="text-text-secondary">Expo Go</span> and scan to run this app natively on your device.</>
                                : <>Scan with your phone camera to open this app in your mobile browser.</>
                            }
                        </p>
                    </div>

                    {qrUrl ? (
                        <div className="flex justify-center py-2">
                            <div className="bg-white p-3 rounded-lg">
                                <QRCodeSVG
                                    value={qrUrl}
                                    size={160}
                                    level="M"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-center py-4">
                            <div className="w-[160px] h-[160px] bg-bg-2 rounded-lg flex items-center justify-center">
                                <p className="text-xs text-text-tertiary text-center px-4">
                                    Starting tunnel…
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="space-y-1.5 pt-1 border-t border-bg-4">
                        {!isNative && (
                            <p className="text-xs text-text-tertiary">
                                <span className="text-[#3ECF8E] font-medium">Note:</span> Browser preview lacks native functions and may look different. Install Expo Go for native testing.
                            </p>
                        )}
                        <div className="flex gap-2">
                            <a
                                href="https://apps.apple.com/app/expo-go/id982107779"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 text-center text-xs py-1.5 px-2 rounded-md border border-bg-4 text-text-tertiary hover:text-text-secondary hover:border-border-primary transition-colors"
                            >
                                App Store
                            </a>
                            <a
                                href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 text-center text-xs py-1.5 px-2 rounded-md border border-bg-4 text-text-tertiary hover:text-text-secondary hover:border-border-primary transition-colors"
                            >
                                Play Store
                            </a>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
