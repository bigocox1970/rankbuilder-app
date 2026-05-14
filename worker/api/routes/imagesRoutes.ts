import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { ScreenshotsController } from '../controllers/screenshots/controller';
import { GeneratedImagesController } from '../controllers/generatedImages/controller';
import { adaptController } from '../honoAdapter';
import { setAuthLevel, AuthConfig } from '../../middleware/auth/routeAuth';

export function setupScreenshotRoutes(app: Hono<AppEnv>): void {
  const screenshotsRouter = new Hono<AppEnv>();
  screenshotsRouter.get('/:id/:file', setAuthLevel(AuthConfig.public), adaptController(ScreenshotsController, ScreenshotsController.serveScreenshot));
  app.route('/api/screenshots', screenshotsRouter);

  const generatedImagesRouter = new Hono<AppEnv>();
  generatedImagesRouter.get('/:agentId/:file', setAuthLevel(AuthConfig.public), adaptController(GeneratedImagesController, GeneratedImagesController.serve));
  app.route('/api/generated-images', generatedImagesRouter);

//   const imagesRouter = new Hono<AppEnv>();
//   // Publicly serve image uploads
//   imagesRouter.get('/:id/:file', setAuthLevel(AuthConfig.authenticated), adaptController(ScreenshotsController, ScreenshotsController.serveScreenshot));

//   app.route('/api/uploads', imagesRouter);
}
