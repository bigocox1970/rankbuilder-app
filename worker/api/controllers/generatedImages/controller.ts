import { BaseController } from '../baseController';
import type { ControllerResponse, ApiResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';

const logger = createLogger('GeneratedImagesController');

function isValidAgentId(id: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function validateFileName(file: string): string | null {
    if (file.includes('..') || file.includes('/') || file.includes('\\') || file.includes('\0')) return null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(file)) return null;
    if (file.startsWith('.')) return null;
    const ext = file.substring(file.lastIndexOf('.') + 1).toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return null;
    return file;
}

export class GeneratedImagesController extends BaseController {
    static async serve(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const agentId = context.pathParams.agentId;
            const file = context.pathParams.file;

            if (!agentId || !file) {
                return GeneratedImagesController.createErrorResponse('Missing path parameters', 400);
            }
            if (!isValidAgentId(agentId)) {
                return GeneratedImagesController.createErrorResponse('Invalid agent id', 400);
            }
            const validFile = validateFileName(file);
            if (!validFile) {
                return GeneratedImagesController.createErrorResponse('Invalid file name', 400);
            }

            const key = `generated-images/${agentId}/${validFile}`;
            const obj = await env.TEMPLATES_BUCKET.get(key);

            if (!obj || !obj.body) {
                return GeneratedImagesController.createErrorResponse('Image not found', 404);
            }

            const ext = validFile.substring(validFile.lastIndexOf('.') + 1).toLowerCase();
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
            const contentType = obj.httpMetadata?.contentType || mimeMap[ext] || 'image/png';

            return new Response(obj.body, {
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=86400',
                    'X-Content-Type-Options': 'nosniff',
                    'Access-Control-Allow-Origin': '*',
                },
            }) as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            logger.error('Error serving generated image', { error });
            return GeneratedImagesController.createErrorResponse('Internal server error', 500);
        }
    }
}
