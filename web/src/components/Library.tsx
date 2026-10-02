import { useState } from 'react';
import { ArrowUpRight, Bookmark, Search, ArrowRight, BookOpen, X } from 'lucide-react';
import { Button } from './ui/button';
import { useStudyState } from '../lib/storage';
import type { LibraryItem } from '../lib/content';
import { ownerReviewLabels } from '../lib/review';

const evidenceLabels = { current: 'Bukti diperiksa JEV', stale: 'Perlu diperiksa ulang', missing: 'Belum ada data pemeriksaan', legacy: 'Catatan format lama' };

export default function Library({ items }: { items: LibraryItem[] }) {
  const [query, setQuery] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const { state, ready, storageError } = useStudyState();
  const normalized = query.trim().toLocaleLowerCase('id');
  const recent = items.filter(item => state.progress[item.id]).sort((a, b) => state.progress[b.id].updated - state.progress[a.id].updated)[0];
  const results = items.flatMap(item => {
    const saved = state.bookmarks[item.id] || [];
    if (savedOnly && !saved.length) return [];
    const matching = normalized ? item.sections.filter(s => `${s.title} ${s.text}`.toLocaleLowerCase('id').includes(normalized)) : [];
    const inTitle = `${item.title} ${item.speaker} ${item.topics.join(' ')}`.toLocaleLowerCase('id').includes(normalized);
    if (normalized && !inTitle && !matching.length) return [];
    return [{ item, matching, saved }];
  });
  return <main id="main" className="library-main">
    <div className="library-intro">
      <div><h1>Ilmu yang dibaca.<br /><em>Bekal yang dijaga.</em></h1>
        <p>Ruang untuk kembali pada catatan kajian,<br className="desktop-break" /> memahami dalil, dan membawa ilmunya ke keseharian.</p>
      </div>
      <aside className="library-note"><BookOpen size={25} strokeWidth={1.3} aria-hidden="true" /><p>Baca perlahan.<br />Telusuri sumbernya.<br />Catat yang ingin diamalkan.</p></aside>
    </div>
    {storageError && <p role="status" className="notice">Penyimpanan browser tidak tersedia atau datanya rusak. Catatan tetap dapat dibaca; progres baru mungkin tidak tersimpan.</p>}
    {ready && recent && <a className="resume-banner" href={`/kajian/${recent.slug}/#${encodeURIComponent(state.progress[recent.id].section)}`}>
      <div><span>Lanjutkan membaca</span><strong>{recent.title}</strong></div><ArrowRight size={20} aria-hidden="true" />
    </a>}
    <section aria-labelledby="library-title" className="library-collection">
      <div className="collection-heading"><h2 id="library-title">Perpustakaan kajian <span>{items.length}</span></h2><span className="muted small">Catatan pribadi, selalu bisa ditinjau kembali.</span></div>
      <div className="library-controls">
        <div className="search-box"><Search size={19} aria-hidden="true" /><input aria-label="Cari kajian atau isi catatan" disabled={!ready} placeholder="Cari judul, pembicara, atau isi catatan…" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <Button variant="ghost" size="icon" aria-label="Hapus pencarian" onClick={() => setQuery('')}><X size={16} /></Button>}
        </div>
        <Button variant={savedOnly ? 'default' : 'outline'} aria-pressed={savedOnly} disabled={!ready} onClick={() => setSavedOnly(!savedOnly)}><Bookmark size={16} />Tersimpan</Button>
      </div>
      <div aria-live="polite" className="search-count">{normalized || savedOnly ? `${results.length} kajian ditemukan` : 'Semua catatan'}</div>
      {!results.length && <div className="empty-state"><BookOpen size={32} strokeWidth={1.2} aria-hidden="true" /><h3>{items.length ? 'Belum ada catatan yang cocok' : 'Perpustakaan masih kosong'}</h3><p>{items.length ? 'Coba kata lain atau tampilkan semua catatan.' : 'Jalankan perintah pembuat catatan, lalu muat ulang halaman ini.'}</p>{items.length > 0 && <Button variant="outline" onClick={() => { setQuery(''); setSavedOnly(false); }}>Tampilkan semua catatan</Button>}</div>}
      {results.map(({ item, matching, saved }) => <article className="library-entry" key={item.id}>
        <div className="entry-spine"><BookOpen size={27} strokeWidth={1.3} aria-hidden="true" /></div>
        <div className="entry-body"><div className="entry-meta"><span>{item.speaker}</span><span className={`draft-label ${item.ownerReview.status === 'reviewed' ? 'owner-reviewed' : ''}`}>{ownerReviewLabels[item.ownerReview.status]}</span><span className={`evidence-freshness ${item.state === 'current' ? 'claim-supported' : 'claim-review'}`}>{evidenceLabels[item.state]}</span></div>
          <h3><a href={`/kajian/${item.slug}/`}>{item.title}</a></h3>
          <p>{item.description.replace(/\*\*\[Perlu ditinjau\]\*\*/g, '').slice(0, 205)}{item.description.length > 205 ? '…' : ''}</p>
          <div className="entry-bottom"><a className="text-link" href={`/kajian/${item.slug}/`}>Buka catatan <ArrowRight size={16} /></a><span className="muted small">{saved.length ? `${saved.length} bagian tersimpan` : 'Dengan tautan sumber'}</span></div>
          {normalized && matching.length > 0 && <ul className="search-matches">{matching.slice(0, 5).map(section => <li key={section.id}><a href={`/kajian/${item.slug}/#${encodeURIComponent(section.id)}`}>{section.title}<ArrowUpRight size={14} aria-hidden="true" /></a></li>)}</ul>}
          {savedOnly && <ul className="search-matches">{item.sections.filter(s => saved.includes(s.id)).map(s => <li key={s.id}><a href={`/kajian/${item.slug}/#${encodeURIComponent(s.id)}`}>{s.title}</a></li>)}</ul>}
        </div>
        <ArrowUpRight className="entry-arrow" size={24} strokeWidth={1.3} aria-hidden="true" />
      </article>)}
    </section>
    <p className="library-bottom-note">Catatan membantu mengulang pelajaran. Rekaman dan sumber rujukan tetap menjadi tempat untuk memeriksa makna.</p>
  </main>;
}
