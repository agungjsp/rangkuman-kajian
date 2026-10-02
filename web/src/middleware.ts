import { defineMiddleware } from 'astro:middleware';
import { timingSafeEqual } from 'node:crypto';
import { csrfToken, json } from './lib/server';

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const host = request.headers.get('host') || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: 'Server hanya tersedia pada alamat lokal.' }, 403);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const token = Buffer.from(request.headers.get('x-csrf-token') || '');
    const expected = Buffer.from(csrfToken);
    if (request.headers.get('origin') !== `http://${host}` || token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return json({ error: 'Sesi halaman tidak berlaku. Muat ulang halaman sebelum melanjutkan.' }, 403);
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Gunakan permintaan JSON.' }, 415);
    if (Number(request.headers.get('content-length')) > 3 * 1024 * 1024) return json({ error: 'Permintaan terlalu besar.' }, 413);
  }
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  return response;
});
