import { test, expect } from '@playwright/test';
import { parseStudy, hash } from '../src/lib/content';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

function ownerFixture() {
  const source = 'Jagalah amanah.';
  const markdown = '# Catatan tinjauan pemilik\n\n## Materi\n\n<!-- study:begin c001 -->\nJagalah amanah.\n\nSumber: [Bagian P001]\n<!-- study:end c001 -->\n\n<!-- study:begin c002 -->\nPelajari amanah.\n\nSumber: [Bagian P001]\n<!-- study:end c002 -->\n';
  const checked_at = '2026-09-30T01:00:00Z';
  const passage = { id: 'P001', timestamp: null, seconds: null, text: source };
  const claim = { kind: 'transcript', source_ids: ['P001'], reference_ids: [], evidence: [passage], check: { verdict: 'insufficient', confidence: .9, model: 'test-fixture', checked_at } };
  const metadata = { schema_version: 2, summary_hash: hash(markdown), transcript_hash: hash(source), checked_at,
    claims: { c001: structuredClone(claim), c002: structuredClone(claim) }, references: [], stats: { total: 2, supported: 0, review: 2 }, human_review: 'pending',
    owner_review: { summary_hash: hash(markdown), transcript_hash: hash(source), checked_at, accepted_claims: {} as Record<string, { reason: string; accepted_at: string }>, reviewed_at: null as string | null } };
  return { source, markdown, metadata, checked_at };
}

test('owner decisions are separate from evidence and expire with their snapshot', () => {
  const { source, markdown, metadata, checked_at } = ownerFixture();
  const parse = (meta: unknown = metadata, raw = markdown, input = source) => parseStudy('review.md', raw, JSON.stringify(meta), input);
  expect(parse().ownerReview.status).toBe('pending');
  metadata.owner_review.accepted_claims.c001 = { reason: 'Source inspected.', accepted_at: checked_at };
  expect(parse().ownerReview.status).toBe('in_progress');
  metadata.human_review = 'reviewed'; metadata.owner_review.reviewed_at = checked_at;
  expect(parse().ownerReview.status).toBe('stale');
  metadata.owner_review.accepted_claims.c002 = { reason: 'Source inspected.', accepted_at: checked_at };
  const reviewed = parse();
  expect(reviewed.ownerReview.status).toBe('reviewed');
  expect(reviewed.sections[0].parts[0].claim?.check?.verdict).toBe('insufficient');
  expect(parse(metadata, markdown.replace('Jagalah amanah.', 'Isi berubah.')).ownerReview.status).toBe('stale');
  expect(parse(metadata, markdown, 'Sumber berubah.').ownerReview.status).toBe('stale');
  expect(parse({ ...metadata, checked_at: '2026-09-30T02:00:00Z' }).ownerReview.status).toBe('stale');
  for (const owner_review of [null, [], {}, { ...metadata.owner_review, accepted_claims: { c999: { reason: 'Unknown.', accepted_at: checked_at } } },
    { ...metadata.owner_review, accepted_claims: { c001: { reason: '  ', accepted_at: checked_at } } },
    { ...metadata.owner_review, reviewed_at: 'bad' }]) {
    const damaged = parse({ ...metadata, owner_review });
    expect(damaged.ownerReview.status).toBe('stale');
    expect(damaged.state).toBe('current');
    expect(damaged.sections[0].parts[0].claim?.check?.verdict).toBe('insufficient');
    expect(damaged.ownerReview.acceptedClaims).toEqual({});
  }
  const { owner_review, ...legacy } = metadata;
  expect(parse({ ...legacy, human_review: 'pending' }).ownerReview.status).toBe('pending');
  expect(parse(legacy).ownerReview.status).toBe('stale');
  expect(parse(metadata, markdown.replace('study:end c001', 'study:end c999')).ownerReview.status).toBe('stale');
  const quoted = markdown + '\n<!-- study:begin ref-r001 -->\n> Sumber asli.\n\nSumber: [r001](https://example.com/source)\n<!-- study:end ref-r001 -->\n';
  const withQuote = { ...metadata, summary_hash: hash(quoted), owner_review: { ...metadata.owner_review, summary_hash: hash(quoted) },
    references: [{ id: 'r001', status: 'resolved', mention: 'Test quotation' }],
    claims: { ...metadata.claims, 'ref-r001': { kind: 'quotation', source_ids: [], reference_ids: ['r001'],
      check: { verdict: 'supports', confidence: null as number | null, model: 'exact-source-copy', checked_at } } } };
  expect(parse(withQuote, quoted).ownerReview.status).toBe('reviewed');
  withQuote.claims['ref-r001'].check.confidence = .95;
  expect(parse(withQuote, quoted).ownerReview.status).toBe('stale');
});

test('owner status, escaped reasons and queue counts survive mobile and no JavaScript', async ({ page, browser }, testInfo) => {
  const id = 'kajian-review-' + randomUUID();
  const root = pathToFileURL(process.env.KAJIAN_ROOT! + '/');
  const { source, markdown, metadata, checked_at } = ownerFixture();
  const input = `transcript/${id}.txt`;
  const meta = { ...metadata, id, title: 'Catatan tinjauan pemilik', transcript_file: input };
  const files = [[input, source], [`summarize/${id}.md`, markdown], [`summarize/${id}.evidence.json`, JSON.stringify(meta)]];
  const created: string[] = [];
  const evidencePath = fileURLToPath(new URL(files[2][0], root));
  const reason = '<script>window.ownerInjected = true</script> Sumber diperiksa. ' + 'alasan'.repeat(100);
  const refresh = async (label: string) => {
    writeFileSync(evidencePath, JSON.stringify(meta));
    await expect(async () => {
      await page.goto(`/kajian/${id}/`);
      await expect(page.locator('.reader-topline .draft-label')).toHaveText(label);
    }).toPass({ timeout: 15000 });
  };
  try {
    for (const [name, data] of files) {
      const path = fileURLToPath(new URL(name, root)); writeFileSync(path, data, { flag: 'wx' }); created.push(path);
    }
    await refresh('Belum ditinjau pemilik');
    meta.owner_review.accepted_claims.c001 = { reason, accepted_at: checked_at };
    await refresh('Tinjauan pemilik berlangsung');
    await page.goto('/');
    await expect(page.locator('.library-entry').filter({ hasText: 'Catatan tinjauan pemilik' }).locator('.draft-label')).toHaveText('Tinjauan pemilik berlangsung');
    await page.goto('/tinjauan/');
    const group = page.locator('.review-group').filter({ has: page.getByRole('heading', { name: 'Catatan tinjauan pemilik', exact: true }) });
    await expect(group.locator('.review-group-heading span')).toHaveText('2 temuan · 1 belum diterima pemilik');
    await expect(group.locator('.review-item')).toHaveCount(2);
    await expect(group.locator('.owner-acceptance')).toContainText(reason);
    await expect(group.locator('.review-item-meta strong').first()).toHaveText('Kutipan belum cukup');
    meta.owner_review.accepted_claims.c002 = { reason: 'Bagian kedua diperiksa.', accepted_at: checked_at };
    meta.human_review = 'reviewed'; meta.owner_review.reviewed_at = checked_at;
    await refresh('Ditinjau pemilik');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Lihat bukti', exact: true }).first().click();
    const panel = page.getByRole('dialog');
    await expect(panel.locator('.owner-acceptance')).toContainText(reason);
    await expect(panel).toContainText('Kutipan belum cukup');
    expect(await page.evaluate(() => 'ownerInjected' in window)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath('owner-review-mobile.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Lihat bukti', exact: true }).first()).toBeFocused();
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL, userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0' });
    try {
      const offline = await context.newPage();
      await offline.goto(`/kajian/${id}/`);
      await expect(offline.locator('.reader-topline .draft-label')).toHaveText('Ditinjau pemilik');
      await offline.goto('/tinjauan/');
      const offlineGroup = offline.locator('.review-group').filter({ has: offline.getByRole('heading', { name: 'Catatan tinjauan pemilik', exact: true }) });
      await expect(offlineGroup.locator('.owner-acceptance').first()).toContainText(reason);
      await expect(offlineGroup.locator('.review-group-heading span')).toHaveText('2 temuan · 0 belum diterima pemilik');
    } finally { await context.close(); }
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('disabled'); } }); });
    await page.goto(`/kajian/${id}/`);
    await expect(page.locator('.reader-topline .draft-label')).toHaveText('Ditinjau pemilik');
    await expect(page.getByRole('status')).toContainText('Penyimpanan browser');
    meta.owner_review.summary_hash = 'stale';
    await refresh('Tinjauan pemilik perlu diulang');
    await expect(page.locator('.owner-review-warning')).toBeVisible();
    await expect(page.locator('.verification-label')).toContainText('Bukti diperiksa JEV');
  } finally { for (const path of created) unlinkSync(path); }
});

test('stale, missing and legacy evidence; unsafe Markdown', () => {
  const raw = '# Catatan\n\n## Materi\n<!-- study:begin c001 -->\nMakna sumber.\n<script>alert(1)</script>\n[bahaya](javascript:alert(1))\n<!-- study:end c001 -->\n';
  const meta = { schema_version: 2, claims: { c001: { kind: 'transcript', source_ids: [], reference_ids: [], check: { verdict: 'supports', confidence: .95 } } }, references: [], summary_hash: hash(raw), transcript_hash: hash('source') };
  const good = parseStudy('test.md', raw, JSON.stringify(meta), 'source');
  expect(good.state).toBe('current');
  expect(good.sections[0].parts[0].html).not.toContain('<script>');
  expect(good.sections[0].parts[0].html).not.toContain('href="javascript:');
  const changed = parseStudy('test.md', raw.replace('Makna', 'Perubahan'), JSON.stringify(meta), 'source');
  expect(changed.state).toBe('stale');
  expect(changed.sections[0].parts[0].claim?.check).toBeUndefined();
  expect(parseStudy('test.md', raw, JSON.stringify(meta), 'changed source').state).toBe('stale');
  expect(parseStudy('test.md', raw).state).toBe('missing');
  expect(parseStudy('test.md', '# Lama\n## Isi\nCatatan.').state).toBe('legacy');
  expect(parseStudy('test.md', raw, 'bad json').state).toBe('stale');
  expect(parseStudy('test.md', raw, JSON.stringify({ ...meta, references: [null] })).state).toBe('stale');
  expect(parseStudy('test.md', raw, JSON.stringify({ ...meta, claims: { c001: {} } })).state).toBe('stale');
});

test('library search, reading controls and stored study state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Ilmu yang dibaca/ })).toBeVisible();
  await expect(page.locator('.evidence-freshness').first()).toHaveText('Bukti diperiksa JEV');
  const search = page.getByRole('textbox', { name: 'Cari kajian atau isi catatan' });
  await search.fill('zzzz-tidak-ada');
  await expect(page.getByRole('heading', { name: 'Belum ada catatan yang cocok' })).toBeVisible();
  await search.fill('kejujuran');
  await expect(page.locator('.search-matches a').first()).toBeVisible();
  await page.getByRole('link', { name: 'Buka catatan' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Amanah (contoh sintetis)');
  const evidence = page.getByRole('button', { name: 'Lihat bukti', exact: true }).first();
  await evidence.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Kutipan transkrip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(evidence).toBeFocused();
  const bookmark = page.getByRole('button', { name: /^Simpan bagian:/ }).first();
  await bookmark.click();
  await expect(page.getByRole('button', { name: /^Hapus simpanan:/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Perbesar teks' }).click();
  await expect(page.locator('.study-article')).toHaveCSS('font-size', '20px');
  const action = page.getByRole('checkbox').first();
  await action.scrollIntoViewIfNeeded();
  await action.check();
  await expect(action).toBeChecked();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('rangkuman-kajian-study-v1') || '{}').progress && Object.keys(JSON.parse(localStorage.getItem('rangkuman-kajian-study-v1') || '{}').progress).length > 0);
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.locator('.study-article')).toHaveCSS('font-size', '20px');
  await expect(page.getByRole('button', { name: /^Hapus simpanan:/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/');
  await expect(page.locator('.resume-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Tersimpan' }).click();
  await expect(page.locator('.library-entry')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('review queue opens the flagged point and its evidence', async ({ page }) => {
  await page.goto('/tinjauan/');
  await expect(page.getByRole('heading', { name: 'Poin yang perlu ditinjau' })).toBeVisible();
  const entry = page.locator('.review-item').first();
  await expect(entry).toBeVisible();
  const link = entry.getByRole('link', { name: 'Buka poin dan bukti' });
  const destination = await link.getAttribute('href');
  const status = await entry.locator('.review-item-meta strong').textContent();
  expect(destination).toMatch(/\?bukti=c\d+#poin-c\d+$/);
  await link.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(status!);
  const id = new URL(destination!, 'http://127.0.0.1:4321').searchParams.get('bukti');
  const point = page.locator(`#poin-${id}`);
  await expect(point).toHaveAttribute('id', `poin-${id}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(point.getByRole('button', { name: 'Lihat bukti' })).toBeFocused();
});

test('mobile contents, source panel and overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Buka catatan' }).first().click();
  await page.getByRole('button', { name: 'Daftar isi', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('link').first().click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Lihat bukti', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Tutup panel' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unavailable browser storage leaves reading usable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('disabled'); } }); });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Penyimpanan browser');
  await page.getByRole('link', { name: 'Buka catatan' }).first().click();
  await expect(page.locator('.study-article')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Penyimpanan browser');
});

test('article remains readable without JavaScript', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL, userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: 'Buka catatan' }).first().click();
  await expect(page.locator('.study-article')).toContainText('Inti Materi');
  await context.close();
});

test('plain TXT evidence shows passage IDs without invented time links or Q&A', async ({ page }, testInfo) => {
  const id = 'kajian-uji-' + randomUUID();
  const root = pathToFileURL(process.env.KAJIAN_ROOT! + '/');
  const input = `transcript/${id}.txt`;
  const raw = 'Pembicara menjelaskan pentingnya amanah.';
  const markdown = '# 📝 Catatan Kajian: Uji transkrip tanpa waktu\n\n**Pembicara:** Pemateri uji\n\n## Inti Materi\n\n<!-- study:begin c001 -->\nPembicara menjelaskan amanah.\n\nSumber: [Bagian P001]\n<!-- study:end c001 -->\n\n## Tanya Jawab\n\nTidak ada sesi tanya jawab yang teridentifikasi.\n';
  const passage = { id: 'P001', timestamp: null, seconds: null, text: raw };
  const metadata = { schema_version: 2, id, title: 'Uji transkrip tanpa waktu', speaker: 'Pemateri uji', source_url: '', transcript_file: input, summary_hash: hash(markdown), transcript_hash: hash(raw), references: [],
    claims: { c001: { kind: 'transcript', source_ids: ['P001'], reference_ids: [], evidence: [{ ...passage, context: [passage] }], check: { verdict: 'supports', confidence: .95, model: 'test-fixture', checked_at: '2026-09-28T00:00:00Z' } } } };
  const created: string[] = [];
  try {
    for (const [name, data] of [[input, raw], [`summarize/${id}.md`, markdown], [`summarize/${id}.evidence.json`, JSON.stringify(metadata)]]) {
      const path = fileURLToPath(new URL(name, root)); writeFileSync(path, data, { flag: 'wx' }); created.push(path);
    }
    await expect(async () => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Uji transkrip tanpa waktu', exact: true })).toBeVisible();
    }).toPass({ timeout: 15000 });
    await page.getByRole('link', { name: 'Uji transkrip tanpa waktu', exact: true }).click();
    await expect(page.locator('.verification-label')).toContainText('Bukti diperiksa JEV');
    await expect(page.locator('.study-article')).toContainText('Tidak ada sesi tanya jawab yang teridentifikasi.');
    await page.getByRole('button', { name: 'Lihat bukti', exact: true }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.locator('.timestamp')).toHaveText('Bagian P001');
    await expect(panel).toContainText(raw);
    await expect(panel.locator('a[href*="t="]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Rekaman kajian' })).toHaveCount(0);
    await panel.screenshot({ path: testInfo.outputPath('plain-evidence.png') });
  } finally { for (const path of created) unlinkSync(path); }
});
