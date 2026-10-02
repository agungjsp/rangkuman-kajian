import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function seedReaderData(root) {
  for (const directory of ['transcript', 'summarize']) mkdirSync(join(root, directory), { recursive: true });
  const digest = text => createHash('sha256').update(text).digest('hex');
  const title = 'Amanah (contoh sintetis)';
  const passage = { id: 'P001', timestamp: null, seconds: null,
    text: 'Pemateri contoh membahas kejujuran dan menyarankan menjaga barang pinjaman.' };
  const source = `title: ${title}\n\n${passage.text}\n`;
  const contents = [
    { id: 'c001', kind: 'transcript', text: 'Pemateri contoh membahas kejujuran.' },
    { id: 'c002', kind: 'transcript', text: 'Catatan sintetis ini sengaja memiliki temuan untuk menguji panel tinjauan.' },
    { id: 'c003', kind: 'action', text: '- [ ] Jaga barang pinjaman sesuai kesepakatan.' },
  ];
  const block = item => `<!-- study:begin ${item.id} -->\n${item.text}\n\nSumber: [Bagian P001]\n<!-- study:end ${item.id} -->`;
  const markdown = `# ${title}\n\n**Pembicara:** Pemateri contoh sintetis\n\n> Data sintetis untuk pengujian. Temuan dan skor di bawah adalah fixture, bukan hasil layanan AI.\n\n## Inti Materi\n\n${block(contents[0])}\n\n${block(contents[1])}\n\n## Saran Penerapan\n\n${block(contents[2])}\n`;
  const checked_at = '2026-01-01T00:00:00Z';
  const claims = Object.fromEntries(contents.map(item => [item.id, {
    kind: item.kind, source_ids: ['P001'], reference_ids: [], text: item.text,
    evidence: [{ ...passage, context: [passage] }],
    check: { verdict: item.id === 'c002' ? 'insufficient' : 'supports', confidence: .95, model: 'synthetic-fixture', checked_at },
  }]));
  const metadata = { schema_version: 2, id: 'kajian-synthetic-reader', slug: 'kajian-synthetic-reader', title,
    transcript_file: 'transcript/synthetic-reader.txt', summary_hash: digest(markdown), transcript_hash: digest(source),
    references: [], claims, checked_at, stats: { total: 3, supported: 2, review: 1 }, human_review: 'pending' };
  writeFileSync(join(root, 'transcript/synthetic-reader.txt'), source);
  writeFileSync(join(root, 'summarize/synthetic-reader.md'), markdown);
  writeFileSync(join(root, 'summarize/synthetic-reader.evidence.json'), JSON.stringify(metadata));
}
