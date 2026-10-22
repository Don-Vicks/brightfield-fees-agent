// The Express app. src/server.ts runs it locally; Vercel finds this file and serves the default export.

import express from 'express';
import { errorHandler, notFound } from './middleware/errors';
import { inspectToolCall } from './middleware/inspect';
import { pages } from './routes/pages';
import { tools } from './routes/tools';

const app = express();
export default app;

app.set('json spaces', 2);
app.set('trust proxy', true);
app.disable('x-powered-by');

// Parse every body as JSON regardless of content-type: tool platforms don't always set it.
app.use(express.json({ type: () => true }));

app.use('/api', (_req, res, next) => {
  res.set('cache-control', 'no-store');
  next();
});

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`));
  next();
});

app.use('/api', pages); // public: health, payment-complete, mock-checkout, receipts
app.use('/api', inspectToolCall, tools); // API key required

app.use(notFound);
app.use(errorHandler);
