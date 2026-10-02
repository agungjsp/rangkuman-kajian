import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = process.env.KAJIAN_ROOT!;
const codeRoot = fileURLToPath(new URL('../../', import.meta.url));
async function post(page: Page, route: string, data: unknown) {
  return page.evaluate(async ({ route, data }) => {
    const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }, { route, data });
}
async function imported(page: Page, title: string) {
  const response = await post(page, '/api/transcripts', { filename: title + '.txt', content: Buffer.from(`title: ${title}\n\nJagalah amanah dalam kehidupan sehari-hari.`).toString('base64') });
  expect(response.status).toBe(201);
  return response.data;
}
async function jobDone(page: Page, id: string) {
  let job: any;
  await expect(async () => {
    job = await (await page.request.get(`/api/jobs/${id}`)).json();
    expect(job.status).not.toBe('running');
  }).toPass({ timeout: 20000, intervals: [100, 300, 500] });
  return job;
}

test('paste, progress, refresh, reader evidence acceptance and approval', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/kelola/');
  await expect(page.getByText('Proses lokal siap menerima satu tugas.')).toBeVisible();
  await page.getByLabel('Tempel teks', { exact: true }).check();
  await page.getByLabel('Judul kajian', { exact: true }).fill('Amanah dari website');
  await page.getByLabel('Isi transkrip', { exact: true }).fill('Jagalah amanah dalam kehidupan sehari-hari.');
  await page.getByRole('button', { name: 'Periksa dan simpan transkrip' }).click();
  await expect(page.getByRole('status')).toContainText('Transkrip diperiksa dan disimpan');
  await expect(page.locator('.transcript-detail')).toContainText('Teks tanpa waktu · 1 bagian');
  writeFileSync(join(root, '.fixture-delay'), '0.7');
  await page.getByRole('button', { name: 'Buat rangkuman', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Proses dimulai');
  await page.reload();
  await expect(page.locator('.job-list li').first()).toContainText('Amanah-dari-website.txt');
  await expect(page.locator('.job-list li').first()).toContainText('Selesai', { timeout: 20000 });
  unlinkSync(join(root, '.fixture-delay'));
  await page.locator('.job-list li').first().getByRole('link', { name: 'Buka catatan', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Amanah dari website');
  await expect(page.locator('.verification-label')).toContainText('Bukti diperiksa JEV');
  await expect(page.locator('.study-article')).toContainText('Tidak ada sesi tanya jawab');
  await page.getByRole('button', { name: 'Lihat bukti', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Alasan penerimaan berdasarkan sumber').fill('Saya memeriksa bagian P001 dan konteksnya; kalimat mempertahankan makna sumber.');
  await page.getByRole('button', { name: 'Terima setelah tinjauan sumber' }).click();
  await expect(page.getByRole('dialog').locator('.owner-acceptance')).toContainText('memeriksa bagian P001');
  await page.keyboard.press('Escape');
  await page.locator('.document-review input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Setujui catatan untuk belajar' }).click();
  await expect(page.locator('.reader-topline .draft-label')).toHaveText('Ditinjau pemilik');
  await page.keyboard.press('Escape');
  const download = await page.getByRole('link', { name: 'Unduh Markdown' }).getAttribute('href');
  expect((await page.request.get(download!)).status()).toBe(200);
  await page.goto('/kelola/');
  await page.getByRole('radio', { name: /Amanah dari website/ }).check();
  await page.getByText('Gunakan perintah terminal', { exact: true }).click();
  await expect(page.locator('.terminal-alternative pre').first()).toContainText('summarize.py');
  await page.screenshot({ path: testInfo.outputPath('manage-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('manage-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('failed verification resumes checkpoint, and stale or concurrent requests are rejected', async ({ page }) => {
  await page.goto('/kelola/');
  let transcript = await imported(page, 'Retry checkpoint');
  writeFileSync(join(root, '.fixture-fail-once'), 'fail');
  const before = existsSync(join(root, '.fixture-codex-calls')) ? readFileSync(join(root, '.fixture-codex-calls'), 'utf8') : '';
  let started = await post(page, '/api/jobs', { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision });
  expect(started.status).toBe(202);
  const failed = await jobDone(page, started.data.id);
  expect(failed.status).toBe('failed');
  expect(failed.error).toContain('Layanan uji');
  const calls = readFileSync(join(root, '.fixture-codex-calls'), 'utf8');
  expect(calls.slice(before.length).trim().split('\n')).toHaveLength(2);
  started = await post(page, '/api/jobs', { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision });
  expect((await jobDone(page, started.data.id)).status).toBe('succeeded');
  expect(readFileSync(join(root, '.fixture-codex-calls'), 'utf8')).toBe(calls);
  expect((await post(page, '/api/jobs', { operation: 'verify', transcript_id: transcript.id, revision: transcript.revision })).status).toBe(409);
  transcript = (await (await page.request.get('/api/transcripts')).json()).find((item: any) => item.id === transcript.id);
  writeFileSync(join(root, '.fixture-delay'), '1');
  started = await post(page, '/api/jobs', { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision, replace: true });
  expect(started.status).toBe(202);
  expect((await post(page, '/api/jobs', { operation: 'verify', transcript_id: transcript.id, revision: transcript.revision })).status).toBe(409);
  const cli = spawnSync('python3', [join(codeRoot, 'summarize.py'), join(root, 'transcript/Retry checkpoint.txt'), '--verify', '--events-json'], {
    env: { ...process.env, KAJIAN_ROOT: root }, encoding: 'utf8',
  });
  expect(cli.status).toBe(2);
  expect(cli.stdout).toContain('"code": "busy"');
  expect((await jobDone(page, started.data.id)).status).toBe('succeeded');
  unlinkSync(join(root, '.fixture-delay'));
});

test('API rejects cross-origin mutations, invalid files, and stale owner review', async ({ page, request }) => {
  await page.goto('/kelola/');
  expect((await request.post('/api/transcripts', { data: { filename: 'bad.txt', content: 'dGV4dA==' } })).status()).toBe(403);
  const token = await page.locator('meta[name=csrf-token]').getAttribute('content');
  expect((await request.post('/api/transcripts', { data: {}, headers: { Origin: 'https://example.com', 'X-CSRF-Token': token! } })).status()).toBe(403);
  expect((await request.get('/api/status', { headers: { Host: 'example.com' } })).status()).toBe(403);
  for (const [filename, bytes] of [['../escape.txt', Buffer.from('text')], ['bad.txt', Buffer.from([255])], ['mixed.md', Buffer.from('**0:01** · Hello\nUnmarked')]] as const) {
    expect((await post(page, '/api/transcripts', { filename, content: bytes.toString('base64') })).status).toBe(400);
  }
  expect((await post(page, '/api/transcripts', { filename: 'large.txt', content: Buffer.alloc(2 * 1024 * 1024 + 1, 'a').toString('base64') })).status).toBe(400);
  let transcript = await imported(page, 'Stale owner review');
  const started = await post(page, '/api/jobs', { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision });
  await jobDone(page, started.data.id);
  transcript = (await (await request.get('/api/transcripts')).json()).find((item: any) => item.id === transcript.id);
  expect((await post(page, `/api/studies/${transcript.slug}/review`, { action: 'approve', revision: transcript.revision, attested: true })).status).toBe(400);
  expect((await post(page, `/api/studies/${transcript.slug}/review`, { action: 'accept', revision: transcript.revision, claim_id: 'c001', reason: ' ' })).status).toBe(400);
  const accepted = await post(page, `/api/studies/${transcript.slug}/review`, { action: 'accept', revision: transcript.revision, claim_id: 'c001', reason: 'Kutipan telah diperiksa.' });
  expect(accepted.status).toBe(200);
  expect((await post(page, `/api/studies/${transcript.slug}/review`, { action: 'unaccept', revision: transcript.revision, claim_id: 'c001' })).status).toBe(409);
  expect((await post(page, `/api/studies/${transcript.slug}/review`, { action: 'unaccept', revision: accepted.data.revision, claim_id: 'c001' })).status).toBe(200);
});

test('ordinary CLI output appears immediately in the server library and history', async ({ page }) => {
  await page.goto('/kelola/');
  const transcript = await imported(page, 'CLI equivalence');
  const result = spawnSync('python3', [join(codeRoot, 'summarize.py'), join(root, 'transcript/CLI equivalence.txt'), '--draft'], {
    encoding: 'utf8', env: { ...process.env, KAJIAN_ROOT: root, TYPESAFE_API_KEY: 'fixture-only',
      PYTHONPATH: [join(codeRoot, 'web/tests/mock-services'), codeRoot].join(delimiter) },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('CLI equivalence.md');
  await page.goto(`/kajian/${transcript.slug}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CLI equivalence');
  const records = await (await page.request.get('/api/jobs')).json();
  expect(records.find((record: any) => record.transcript_id === transcript.id)).toMatchObject({ origin: 'command', status: 'succeeded' });
});

test('queue owner review saves the correct point and reopens approval', async ({ page }) => {
  await page.goto('/kelola/');
  const transcript = await imported(page, 'Queue owner review');
  const started = await post(page, '/api/jobs', { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision });
  expect((await jobDone(page, started.data.id)).status).toBe('succeeded');
  await page.goto(`/tinjauan/#review-${transcript.slug}`);
  const group = page.locator(`#review-${transcript.slug}`);
  await group.getByText('Catat keputusan pemilik', { exact: true }).click();
  await group.getByLabel('Alasan penerimaan berdasarkan sumber').fill('Bagian P001 telah diperiksa; makna sumber tetap dipertahankan.');
  await group.getByRole('button', { name: 'Terima setelah tinjauan sumber' }).click();
  await expect(group.locator('.owner-acceptance')).toContainText('Bagian P001 telah diperiksa');
  await group.getByLabel(/Saya telah meninjau seluruh catatan/).check();
  await group.getByRole('button', { name: 'Setujui catatan untuk belajar' }).click();
  await expect(group).toContainText('Ditinjau pemilik');
  await group.getByText('Catat keputusan pemilik', { exact: true }).click();
  await group.getByRole('button', { name: 'Buka kembali poin' }).click();
  await expect(group.locator('.owner-acceptance')).toHaveCount(0);
  await expect(group).toContainText('Belum ditinjau pemilik');
});

test('upload, copy command, retry and confirmed regeneration controls', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).copiedCommand = text; } } }));
  await page.goto('/kelola/');
  await expect(page.getByText('Proses lokal siap menerima satu tugas.')).toBeVisible();
  await page.getByLabel('Berkas transkrip', { exact: true }).setInputFiles({ name: 'أمانة upload.txt', mimeType: 'text/plain', buffer: Buffer.from('Jagalah amanah dalam kehidupan sehari-hari.') });
  await page.getByRole('button', { name: 'Periksa dan simpan transkrip' }).click();
  await expect(page.getByRole('status')).toContainText('Transkrip diperiksa dan disimpan');
  await page.getByText('Gunakan perintah terminal', { exact: true }).click();
  await page.getByRole('button', { name: 'Salin perintah draf', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedCommand)).toContain("'transcript/أمانة upload.txt'");
  writeFileSync(join(root, '.fixture-fail-once'), 'fail');
  await page.getByRole('button', { name: 'Buat rangkuman', exact: true }).click();
  const job = page.locator('.job-list li').first();
  await expect(job).toContainText('Layanan uji', { timeout: 15000 });
  await job.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.locator('.job-list li').first()).toContainText('Selesai', { timeout: 15000 });
  await page.getByText('Buat ulang rangkuman', { exact: true }).click();
  const regenerate = page.getByRole('button', { name: 'Buat ulang dan arsipkan versi lama' });
  await expect(regenerate).toBeDisabled();
  await page.getByLabel('Saya memahami penggantian isi dan pengulangan tinjauan.').check();
  const count = await page.locator('.job-list li').count();
  await regenerate.click();
  await expect(page.locator('.job-list li')).toHaveCount(count + 1);
  await expect(page.locator('.job-list li').first()).toContainText('Selesai', { timeout: 15000 });
  expect(readdirSync(join(root, 'summarize/archive')).some(file => file.startsWith('أمانة upload-') && file.endsWith('.evidence.json'))).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Periksa ulang', exact: true }).click();
  await expect(page.locator('.job-list li').first()).toContainText('Pemeriksaan bukti');
  await expect(page.locator('.job-list li').first()).toContainText('Selesai', { timeout: 15000 });
});

test('readiness errors disable AI actions and management explains JavaScript requirement', async ({ page, browser }, testInfo) => {
  await page.route('**/api/status', route => route.fulfill({ json: { python: true, codex: false, typesafe: false, busy: false, active: null } }));
  await page.goto('/kelola/');
  await expect(page.getByText('Persiapan untuk membuat rangkuman', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Amanah \(contoh sintetis\)/ }).check();
  await expect(page.getByRole('button', { name: 'Periksa ulang', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Buka catatan', exact: true }).first()).toBeEnabled();
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL, userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0' });
  try {
    const offline = await context.newPage();
    await offline.goto('/kelola/');
    await expect(offline.getByText(/Pengelolaan rangkuman memerlukan JavaScript/)).toBeVisible();
  } finally { await context.close(); }
});

test('worker survives a server restart and publishes once', async ({ page, request }) => {
  await page.goto('/kelola/');
  const transcript = await imported(page, 'Restart worker');
  writeFileSync(join(root, '.fixture-delay'), '1.5');
  const launch = () => spawn('node', ['tests/server.mjs'], { cwd: join(codeRoot, 'web'),
    env: { ...process.env, PORT: '4332', KAJIAN_ROOT: root }, stdio: 'ignore' });
  let server = launch();
  const base = 'http://127.0.0.1:4332';
  const ready = async () => {
    await expect(async () => expect((await request.get(base + '/api/status')).ok()).toBe(true)).toPass({ timeout: 10000 });
  };
  try {
    await ready();
    const html = await (await request.get(base + '/kelola/')).text();
    const token = html.match(/<meta name="csrf-token" content="([^"]+)"/)![1];
    const response = await request.post(base + '/api/jobs', { headers: { Origin: base, 'X-CSRF-Token': token },
      data: { operation: 'draft', transcript_id: transcript.id, revision: transcript.revision } });
    expect(response.status()).toBe(202);
    const job = await response.json();
    server.kill('SIGTERM');
    await new Promise<void>(resolve => server.once('exit', () => resolve()));
    server = launch();
    await ready();
    expect((await jobDone(page, job.id)).status).toBe('succeeded');
    const history = await (await request.get(base + '/api/jobs')).json();
    expect(history.filter((record: any) => record.transcript_id === transcript.id)).toHaveLength(1);
    expect((await request.get(base + `/kajian/${transcript.slug}/`)).status()).toBe(200);
  } finally {
    server.kill('SIGTERM');
    if (existsSync(join(root, '.fixture-delay'))) unlinkSync(join(root, '.fixture-delay'));
  }
});
