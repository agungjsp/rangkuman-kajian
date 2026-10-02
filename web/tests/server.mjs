import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.TYPESAFE_API_KEY = 'playwright-fixture-only';
process.env.PYTHONPATH = [fileURLToPath(new URL('./mock-services/', import.meta.url)), resolve('..')].join(delimiter);
await import('../start.mjs');
