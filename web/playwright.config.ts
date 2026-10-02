import { defineConfig } from '@playwright/test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedReaderData } from './tests/seed-data.mjs';
if (!process.env.KAJIAN_TEST_ROOT) {
  process.env.KAJIAN_TEST_ROOT = mkdtempSync(join(tmpdir(), 'kajian-web-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  cpSync(join(root, 'prompts'), join(process.env.KAJIAN_TEST_ROOT, 'prompts'), { recursive: true });
  seedReaderData(process.env.KAJIAN_TEST_ROOT);
}
process.env.KAJIAN_ROOT = process.env.KAJIAN_TEST_ROOT;
export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4327',
    viewport: { width: 1280, height: 900 },
    userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:4327', reuseExistingServer: false,
    env: { PORT: '4327', KAJIAN_ROOT: process.env.KAJIAN_TEST_ROOT! } },
});
