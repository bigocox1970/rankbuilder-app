import type { ReactNode } from 'react';

interface ExpoPhoneFrameProps {
    children: ReactNode;
}

/**
 * Renders an iPhone-style bezel (with a soft colour glow) around an Expo web
 * preview so mobile apps are shown at a realistic device size. The inner screen
 * fills the available area; the frame keeps a true iPhone aspect ratio
 * (390 x 844) and scales to the available height.
 */
export function ExpoPhoneFrame({ children }: ExpoPhoneFrameProps) {
    return (
        <div className="relative h-full max-h-full" style={{ aspectRatio: '390 / 844' }}>
            {/* Device body with a tight green rim glow hugging the bezel */}
            <div
                className="relative h-full w-full bg-black rounded-[3rem] ring-1 ring-white/15 p-[10px]"
                style={{
                    boxShadow:
                        '0 0 16px 1px rgba(0, 230, 118, 0.55), 0 0 32px 4px rgba(0, 230, 118, 0.22)',
                }}
            >
                {/* Dynamic island */}
                <div className="absolute top-[18px] left-1/2 -translate-x-1/2 z-10 h-[26px] w-[34%] bg-black rounded-full" />
                {/* Screen */}
                <div className="relative h-full w-full overflow-hidden rounded-[2.4rem] bg-white">
                    {children}
                </div>
            </div>
        </div>
    );
}
