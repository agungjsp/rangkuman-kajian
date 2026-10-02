import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

declare const __KAJIAN_PROJECT_ROOT__: string;
export const codeRoot = typeof __KAJIAN_PROJECT_ROOT__ === 'string' ? __KAJIAN_PROJECT_ROOT__ : resolve(process.cwd(), '..');
export const dataRoot = resolve(process.env.KAJIAN_ROOT || codeRoot);
const local = globalThis as typeof globalThis & { kajianCsrf?: string };
export const csrfToken = local.kajianCsrf ??= randomBytes(32).toString('hex');

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const errorStatus: Record<string, number> = { busy: 409, conflict: 409, not_found: 404, prerequisite: 503, failed: 500 };
export function python(request: Record<string, unknown>, background = false): Promise<any> {
  return new Promise((accept, reject) => {
    const child = spawn('python3', [join(codeRoot, 'summarize.py'), '--web-request'], {
      cwd: codeRoot, env: { ...process.env, KAJIAN_ROOT: dataRoot, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'ignore'], detached: background,
    });
    let pending = '', settled = false, result: unknown;
    const fail = (message: string, status = 500) => {
      if (!settled) { settled = true; reject(new ApiError(message, status)); }
    };
    child.on('error', () => fail('Python tidak dapat dijalankan. Periksa instalasi Python 3 dan mulai ulang server.', 503));
    child.stdin.on('error', () => { /* Process exit is handled below. */ });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      if (pending.length > 8 * 1024 * 1024) { child.kill(); fail('Respons proses terlalu besar.'); return; }
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'error') fail(event.message, errorStatus[event.code] || 400);
          if (event.type === 'result') result = event.result;
          if (background && event.type === 'job' && !settled) {
            settled = true; accept(event.job); child.unref();
          }
        } catch { fail('Respons proses tidak valid.'); }
      }
    });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0 || result === undefined) fail('Proses tidak selesai. Periksa riwayat proses lalu coba lagi.');
      else { settled = true; accept(result); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function body(request: Request): Promise<Record<string, any>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('Permintaan kosong.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new ApiError('Permintaan melebihi batas 3 MiB.', 413); }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new ApiError('JSON permintaan tidak valid.'); }
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function endpoint(run: () => Promise<unknown>, status = 200) {
  try { return json(await run(), status); }
  catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'Operasi gagal. Muat ulang halaman dan coba lagi.' }, error instanceof ApiError ? error.status : 500);
  }
}
