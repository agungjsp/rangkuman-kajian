import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { dataRoot } from './server';
import MarkdownIt from 'markdown-it';
import { parseOwnerReview, type OwnerReview } from './review';

export type Passage = { id: string; timestamp: string | null; seconds: number | null; text: string; context?: Passage[] };
export type Finding = { verdict: string; confidence: number | null; model: string; checked_at: string };
export type Reference = {
  id: string; status: string; mention: string; reason?: string; provider?: string;
  locator?: string; text?: string; arabic?: string; attribution?: string; grade?: string;
  url?: string; retrieved_at?: string; match?: Finding; passages?: Passage[];
};
export type Claim = {
  id?: string; kind: string; text?: string; source_ids: string[]; reference_ids: string[];
  evidence?: (Passage | Reference)[]; check?: Finding; content_hash?: string;
};
export type Part = { html: string; text: string; claimId?: string; actionKey?: string; claim?: Claim };
export type Section = { id: string; title: string; level: number; text: string; parts: Part[] };
export type Study = {
  id: string; slug: string; title: string; speaker: string; source: string; filename: string;
  markdown: string; sections: Section[]; topics: string[]; description: string;
  state: 'current' | 'stale' | 'missing' | 'legacy'; references: Reference[];
  ownerReview: OwnerReview;
  revision?: string;
  stats?: { total: number; supported: number; review: number }; checkedAt?: string;
};
export type LibraryItem = Pick<Study, 'id' | 'slug' | 'title' | 'speaker' | 'description' | 'state' | 'topics' | 'ownerReview'> & {
  sections: { id: string; title: string; text: string }[];
};

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const plain = (text: string) => text.replace(/<!--.*?-->/gs, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*>_`]/g, '').replace(/\s+/g, ' ').trim();
const safeUrl = (url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.renderer.rules.paragraph_open = (tokens, idx, options, _env, self) => {
  if (tokens[idx + 1]?.content.startsWith('Sumber: ')) tokens[idx].attrSet('class', 'source-citations');
  return self.renderToken(tokens, idx, options);
};
const defaultLink = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('rel', 'noreferrer noopener');
  tokens[idx].attrSet('target', '_blank');
  return defaultLink ? defaultLink(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

export function parseStudy(filename: string, markdown: string, rawEvidence?: string, transcript?: string): Study {
  let metadata: Record<string, any> | undefined;
  let invalid = false;
  if (rawEvidence) {
    try {
      const value = JSON.parse(rawEvidence);
      const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(x => typeof x === 'string');
      if (value.schema_version !== 2 || !value.claims || typeof value.claims !== 'object' || Array.isArray(value.claims) || !Array.isArray(value.references)) throw new Error('schema');
      if (!value.references.every((r: any) => r && typeof r.id === 'string' && typeof r.status === 'string' && typeof r.mention === 'string')) throw new Error('references');
      if (!Object.values(value.claims).every((c: any) => c && ['transcript', 'external', 'quotation', 'action'].includes(c.kind) && strings(c.source_ids) && strings(c.reference_ids) &&
        (!c.evidence || Array.isArray(c.evidence) && c.evidence.every((e: any) => e && typeof e === 'object')) &&
        (!c.check || ['supports', 'contradicts', 'insufficient'].includes(c.check.verdict) && (c.check.confidence === null || typeof c.check.confidence === 'number' && c.check.confidence >= 0 && c.check.confidence <= 1)))) throw new Error('claims');
      metadata = value;
    } catch { invalid = true; }
  }
  const marked = markdown.includes('<!-- study:');
  const current = metadata && metadata.summary_hash === hash(markdown) && transcript !== undefined && metadata.transcript_hash === hash(transcript);
  const state: Study['state'] = current ? 'current' : metadata || invalid ? 'stale' : marked ? 'missing' : 'legacy';
  const source = safeUrl(markdown.match(/\[Video sumber\]\(([^)]+)\)/)?.[1] || metadata?.source_url);
  const id = typeof metadata?.id === 'string' ? metadata.id : 'kajian-' + hash(source || filename).slice(0, 12);
  const slug = /^[a-z0-9-]+$/.test(id) ? id : 'kajian-' + hash(id).slice(0, 12);
  const title = (markdown.match(/^#+ (?:📝 Catatan Kajian: )?(.+)$/m)?.[1] || metadata?.title || filename).replace(/^\[LIVE\]\s*/i, '');
  const speaker = markdown.match(/\*\*Pembicara:\*\*\s*(.+)/)?.[1] || metadata?.speaker || title.match(/-\s*(Ustadz.+)/)?.[1] || 'Pembicara belum dicatat';
  const body = markdown.split('\n<!-- study:report -->')[0].split('\n## Pemeriksaan bukti JEV')[0];
  const blockIds = [...body.matchAll(/<!-- study:begin ([a-z0-9-]+) -->\s*\n[\s\S]*?\n<!-- study:end \1 -->/g)].map(match => match[1]);
  const ownerReview = parseOwnerReview(metadata, !!current && blockIds.length * 2 === (body.match(/<!-- study:/g) || []).length, blockIds);
  const tokens = md.parse(body, {});
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' && ['h2', 'h3'].includes(token.tag) && token.map
    ? [{ line: token.map[0], end: token.map[1], level: Number(token.tag.slice(1)), title: tokens[index + 1].content }] : []);
  const lines = body.split('\n');
  const duplicates = new Map<string, number>();
  const sections: Section[] = headings.map((heading, index) => {
    const base = heading.title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'bagian';
    const count = (duplicates.get(base) || 0) + 1; duplicates.set(base, count);
    const sectionId = 'bagian-' + base + (count > 1 ? '-' + count : '');
    const sourceText = lines.slice(heading.end, headings[index + 1]?.line ?? lines.length).join('\n');
    const parts: Part[] = [];
    let end = 0;
    const addPlain = (text: string) => {
      const cleaned = text.replace(/<!-- study:[\s\S]*?-->/g, '').trim();
      if (cleaned) parts.push({ html: md.render(cleaned), text: plain(cleaned) });
    };
    for (const match of sourceText.matchAll(/<!-- study:begin ([a-z0-9-]+) -->\s*\n([\s\S]*?)\n<!-- study:end \1 -->/g)) {
      addPlain(sourceText.slice(end, match.index));
      const descriptor = metadata?.claims?.[match[1]] as Claim | undefined;
      const text = match[2];
      const isAction = /^- \[[ xX]\]/.test(text.trim());
      const actionText = text.split('\nSumber:')[0].replace(/^- \[[ xX]\]\s*/, '').trim();
      parts.push({
        html: md.render(isAction ? text.replace(/^- \[[ xX]\]\s*/, '') : text), text: plain(text), claimId: match[1],
        actionKey: isAction ? hash(actionText).slice(0, 20) : undefined,
        claim: descriptor ? { ...descriptor, check: current ? descriptor.check : undefined } : undefined,
      });
      end = (match.index || 0) + match[0].length;
    }
    addPlain(sourceText.slice(end));
    return { id: sectionId, title: heading.title, level: heading.level, text: plain(sourceText), parts };
  });
  if (!sections.length) sections.push({ id: 'bagian-catatan', title: 'Catatan', level: 2, text: plain(body), parts: [{ html: md.render(body), text: plain(body) }] });
  return { id, slug, title, speaker, source, filename, markdown, sections, state, ownerReview,
    topics: sections.filter(s => s.level === 3).map(s => s.title),
    description: sections.find(s => /Inti Materi|Ikhtisar/i.test(s.title))?.text.slice(0, 240) || sections[0].text.slice(0, 240),
    references: (metadata?.references || []).map((r: Reference) => ({ ...r, url: safeUrl(r.url) })),
    stats: current ? metadata?.stats : undefined, checkedAt: current ? metadata?.checked_at : undefined };
}

export function getStudies(): Study[] {
  const summaries = join(dataRoot, 'summarize');
  if (!existsSync(summaries)) return [];
  const read = (base: string, file: string): Buffer | undefined => {
    try {
      const distance = relative(realpathSync(base), realpathSync(file));
      if (distance === '..' || distance.startsWith('..' + sep) || isAbsolute(distance)) return undefined;
      return readFileSync(file);
    } catch { return undefined; }
  };
  return readdirSync(summaries).filter(filename => filename.endsWith('.md')).flatMap(filename => {
    const markdown = read(summaries, join(summaries, filename));
    if (!markdown) return [];
    const evidence = read(summaries, join(summaries, filename.replace(/\.md$/, '.evidence.json')));
    let transcriptPath = join(dataRoot, 'transcript', filename);
    try {
      const stored = JSON.parse(evidence?.toString('utf8') || '').transcript_file;
      if (typeof stored === 'string') transcriptPath = resolve(dataRoot, stored);
    } catch { /* Legacy notes use the matching Markdown filename. */ }
    const transcript = read(join(dataRoot, 'transcript'), transcriptPath);
    const study = parseStudy(filename, markdown.toString('utf8'), evidence?.toString('utf8'), transcript?.toString('utf8'));
    if (transcript && transcriptPath.replace(/.*[/\\]/, '').replace(/\.(md|txt)$/, '.md') === filename) {
      const revision = createHash('sha256');
      for (const bytes of [transcript, markdown, evidence]) revision.update(bytes === undefined ? 'missing' : Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]));
      study.revision = revision.digest('hex');
    }
    return [study];
  }).sort((a, b) => a.title.localeCompare(b.title, 'id'));
}

export function libraryItems(): LibraryItem[] {
  return getStudies().map(({ id, slug, title, speaker, description, state, topics, sections, ownerReview }) => ({
    id, slug, title, speaker, description, state, topics, ownerReview,
    sections: sections.map(({ id, title, text }) => ({ id, title, text })),
  }));
}
