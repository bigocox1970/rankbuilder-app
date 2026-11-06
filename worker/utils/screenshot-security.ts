import { JWTUtils } from './jwtUtils';

const SCREENSHOT_PATH_PREFIX = '/api/screenshots/';

export class ScreenshotSecurity {
    private static readonly TOKEN_EXPIRY = 6 * 60 * 60; // 6 hours

    private jwt: JWTUtils;

    constructor(env: { JWT_SECRET: string }) {
        this.jwt = JWTUtils.getInstance(env);
    }

    async signUrl(url: string, appId: string): Promise<string> {
        const isAbsolute = url.startsWith('http://') || url.startsWith('https://');

        let parsed: URL;
        try {
            parsed = new URL(url, 'http://localhost');
        } catch {
            return url;
        }

        if (!parsed.pathname.startsWith(SCREENSHOT_PATH_PREFIX)) return url;

        const token = await this.jwt.signPayload({ appId, purpose: 'screenshot' }, ScreenshotSecurity.TOKEN_EXPIRY);
        parsed.searchParams.set('token', token);
        return isAbsolute ? parsed.toString() : parsed.pathname + parsed.search;
    }

    async enrichUrls<T extends { id: string; screenshotUrl?: string | null }>(apps: T[]): Promise<T[]> {
        return apps;
    }

    async verifyToken(token: string, expectedAppId: string): Promise<boolean> {
        const payload = await this.jwt.verifyPayload(token);
        return payload?.appId === expectedAppId && payload?.purpose === 'screenshot';
    }
}
