import { fileURLToPath } from 'node:url';
process.env.HOST = '127.0.0.1';
process.env.PORT ||= '4321';
process.env.KAJIAN_ROOT ||= fileURLToPath(new URL('../', import.meta.url));
await import('./dist/server/entry.mjs');
