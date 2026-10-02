import { rmSync } from 'node:fs';
export default function teardown() {
  if (process.env.KAJIAN_TEST_ROOT) rmSync(process.env.KAJIAN_TEST_ROOT, { recursive: true, force: true });
}
