import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { attachUser } from './auth';
import { db } from './db';
import { HttpError } from './http';
import { authRouter } from './routes/auth';
import { billingRouter } from './routes/billing';
import { catalogRouter } from './routes/catalog';
import { customersRouter } from './routes/customers';
import { insightsRouter } from './routes/insights';
import { portalRouter } from './routes/portal';
import { publicRouter } from './routes/public';
import { subscriptionsRouter } from './routes/subscriptions';
import { teamRouter } from './routes/team';

/** Blocks cross-site writes: browsers always send Origin on them, and it must match our host. */
function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* A malformed Origin falls through to the rejection below. */
    }
    if (host !== req.get('host')) throw new HttpError(403, 'Cross-site request blocked');
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          // Only upgrade when actually served over TLS, so `npm start` on localhost keeps working.
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: process.env.NODE_ENV === 'production' && Boolean(process.env.TRUST_PROXY),
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));
  app.use(attachUser);

  const api = express.Router();
  api.use(sameOrigin);
  api.get('/health', (_req, res) => {
    db().prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  if (process.env.NODE_ENV !== 'test') {
    const limits = { windowMs: 15 * 60_000, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in a few minutes.' } } as const;
    // Counts failures per account and address, so one person's typos never lock out a shared office or venue network.
    api.use(
      '/auth/login',
      rateLimit({
        ...limits,
        limit: 10,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
      }),
    );
    api.use(['/auth/signup', '/auth/forgot-password', '/auth/reset-password'], rateLimit({ ...limits, limit: 60 }));
  }
  api.use('/auth', authRouter);
  api.use('/public', publicRouter);
  api.use('/portal', portalRouter);
  api.use('/customers', customersRouter);
  api.use('/subscriptions', subscriptionsRouter);
  // These routers define full paths and guard themselves, so an unmatched request falls through.
  api.use(catalogRouter);
  api.use(billingRouter);
  api.use(insightsRouter);
  api.use(teamRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  const dist = path.resolve('dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, fields: err.fields });
    const body = err as { type?: string; status?: number; code?: string };
    if (body?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return void res.status(422).json({ error: 'That refers to a record that no longer exists' });
    if (body?.type === 'entity.parse.failed' || body?.type === 'entity.too.large') {
      return void res.status(body.status ?? 400).json({ error: 'That request could not be read' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });
  return app;
}
