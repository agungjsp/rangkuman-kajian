import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Check, Download, ExternalLink, List, Minus, Plus, Printer, X, PanelRightOpen, CircleHelp } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { useStudyState } from '../lib/storage';
import { claimStatus, needsReview, ownerReviewLabels } from '../lib/review';
import type { Study, Part, Passage, Reference } from '../lib/content';
import ReviewControls from './ReviewControls';

const labels: Record<Study['state'], string> = { current: 'Bukti diperiksa JEV', stale: 'Perlu diperiksa ulang', missing: 'Belum ada data pemeriksaan', legacy: 'Catatan format lama' };

function Evidence({ part, study }: { part: Part; study: Study }) {
  const claim = part.claim;
  const refs = study.references.filter(r => claim?.reference_ids.includes(r.id));
  const passages = (claim?.evidence || []).filter((e): e is Passage => 'timestamp' in e);
  const acceptance = part.claimId ? study.ownerReview.acceptedClaims[part.claimId] : undefined;
  return <div className="evidence-body">
    <div className="evidence-selection"><span className="small muted">Poin yang sedang dibaca</span><p>{part.text.split('Sumber:')[0]}</p></div>
    <div className="evidence-status"><strong>{study.state === 'current' ? claimStatus(claim) : labels[study.state]}</strong>
      {study.state !== 'current' && <p>Isi catatan atau transkrip belum cocok dengan pemeriksaan terakhir. Jalankan kembali verifikasi sebelum memakai hasil JEV.</p>}
      {study.state === 'current' && claim?.check && <>
        {claim.check.confidence !== null && <p>Keyakinan model: {claim.check.confidence.toFixed(2)} <span className="muted">· ambang sementara 0,80</span></p>}
        <p className="small muted">{claim.check.model} · {new Date(claim.check.checked_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>
      </>}
      <p className="small">Pemeriksaan ini menilai dukungan sumber. Skor model bukan ukuran kesahihan agama.</p>
    </div>
    {acceptance && <section className="owner-acceptance"><h3>Diterima pemilik setelah tinjauan sumber</h3><p>{acceptance.reason}</p><p className="small muted">{new Date(acceptance.accepted_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })} · Temuan JEV tetap berlaku sebagai hasil otomatis.</p></section>}
    {study.ownerReview.status === 'stale' && <p className="notice">Tinjauan pemilik tidak berlaku untuk versi ini atau datanya rusak. <a href="/kelola/">Periksa ulang catatan</a> sebelum mengulang tinjauan.</p>}
    {passages.length > 0 && <section><h3>Kutipan transkrip</h3>{passages.map(p => <div className="evidence-passage" key={p.id}>
      {p.seconds !== null && p.timestamp && study.source ? <a className="timestamp" href={`${study.source}${study.source.includes('?') ? '&' : '?'}t=${p.seconds}s`} target="_blank" rel="noreferrer">{p.timestamp}<ExternalLink size={12} /></a> : <span className="timestamp">Bagian {p.id}{p.timestamp ? ` · ${p.timestamp}` : ''}</span>}
      <p dir="auto">{p.text}</p>
      {p.context && <details><summary>Konteks sekitar kutipan</summary>{p.context.map(context => <p key={context.id} dir="auto"><strong>{context.timestamp || `Bagian ${context.id}`}</strong> {context.text}</p>)}</details>}
    </div>)}</section>}
    {refs.length > 0 && <section><h3>Referensi tambahan</h3>{refs.map(ref => <ReferenceDetail reference={ref} current={study.state === 'current'} key={ref.id} />)}</section>}
    {!passages.length && !refs.length && <p>Data kutipan belum tersedia untuk blok ini. Gunakan tautan sumber pada catatan atau buat ulang metadata bukti.</p>}
    {study.state === 'current' && study.ownerReview.status !== 'stale' && part.claimId && needsReview(claim) && <ReviewControls slug={study.slug} revision={study.revision} claimId={part.claimId} accepted={!!acceptance} reopenEvidence />}
  </div>;
}

function ReferenceDetail({ reference: r, current }: { reference: Reference; current: boolean }) {
  return <div className="reference-detail"><strong>{r.locator || r.mention}</strong>
    <p className="small muted">{r.provider || 'Referensi belum ditemukan'}</p>
    {r.text && <p dir="auto">{r.text}</p>}
    {r.arabic && <details><summary>Teks Arab</summary><p className="arabic" dir="rtl" lang="ar">{r.arabic}</p></details>}
    {r.attribution && <p className="small">Atribusi sumber: {r.attribution}</p>}
    {r.grade && <p className="small">Penilaian yang dicantumkan penyedia: {r.grade}</p>}
    {current && r.match && <p className="small">Pencocokan rujukan: {r.match.confidence === null ? 'nomor surah dan ayat disebut dalam transkrip' : `JEV, keyakinan model ${r.match.confidence.toFixed(2)}`}.</p>}
    {r.reason && <p className="notice">{r.reason}</p>}
    {r.url && <a className="text-link" href={r.url} target="_blank" rel="noreferrer">Buka sumber<ExternalLink size={14} /></a>}
    {r.retrieved_at && <p className="small muted">Diambil {new Date(r.retrieved_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>}
  </div>;
}

export default function Reader({ study }: { study: Study }) {
  const { state, update, ready, storageError } = useStudyState();
  const [selected, setSelected] = useState<Part | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [active, setActive] = useState(study.sections[0]?.id);
  const [resume, setResume] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const contentsTrigger = useRef<HTMLButtonElement | null>(null);
  const contentsDestination = useRef<string | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const initialProgress = useRef(false);
  const saved = state.bookmarks[study.id] || [];
  const actions = state.actions[study.id] || {};
  const actionParts = study.sections.flatMap(s => s.parts).filter(p => p.actionKey);
  const pendingReview = study.sections.flatMap(s => s.parts).filter(p => p.claimId && needsReview(p.claim) && !study.ownerReview.acceptedClaims[p.claimId]).length;

  useEffect(() => {
    const media = matchMedia('(min-width: 1600px)');
    const change = () => setWide(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('bukti');
    if (!id) return;
    const part = study.sections.flatMap(section => section.parts).find(item => item.claimId === id);
    if (!part) return;
    trigger.current = document.getElementById(`poin-${id}`)?.querySelector<HTMLButtonElement>('.claim-controls button') || null;
    setSelected(part);
  }, [study.sections]);
  useEffect(() => {
    if (ready && !initialProgress.current) {
      setResume(state.progress[study.id]?.section || '');
      initialProgress.current = true;
    }
  }, [ready, state.progress, study.id]);
  useEffect(() => {
    if (!ready) return;
    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        let current = study.sections[0]?.id;
        for (const section of study.sections) {
          if ((document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity) <= 180) current = section.id;
        }
        if (current) {
          setActive(current);
          update(old => ({ ...old, progress: { ...old.progress, [study.id]: { section: current, updated: Date.now() } } }));
        }
      }, 180);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { clearTimeout(timeout); window.removeEventListener('scroll', onScroll); };
  }, [ready, study.id]);
  useEffect(() => {
    if (selected && wide) panel.current?.focus();
  }, [selected, wide]);
  const closeEvidence = () => { setSelected(null); trigger.current?.focus(); };
  const contents = <nav aria-label="Daftar isi kajian"><ul className="contents-list">{study.sections.map(section => <li key={section.id} className={section.level === 3 ? 'subsection' : ''}>
    <a href={'#' + section.id} aria-current={active === section.id ? 'location' : undefined} onClick={() => { contentsDestination.current = section.id; setActive(section.id); setContentsOpen(false); }}>{section.title.replace(/^[^\p{L}\p{N}]+/u, '')}</a>
  </li>)}</ul></nav>;
  const toggleBookmark = (id: string) => update(old => {
    const marks = old.bookmarks[study.id] || [];
    return { ...old, bookmarks: { ...old.bookmarks, [study.id]: marks.includes(id) ? marks.filter(x => x !== id) : [...marks, id] } };
  });

  return <main id="main" className={`reader-main ${wide && selected ? 'evidence-open' : ''}`}>
    <div className="reader-topline"><a className="text-link" href="/"><ArrowLeft size={15} />Perpustakaan</a><span className={`draft-label ${study.ownerReview.status === 'reviewed' ? 'owner-reviewed' : ''}`}>{ownerReviewLabels[study.ownerReview.status]}</span></div>
    <div className="reader-shell">
      <aside className="contents-sidebar"><h2>Dalam catatan ini</h2>{contents}<div className="sidebar-note">Buka <strong>Lihat bukti</strong> untuk membaca kutipan yang mendasari setiap poin.</div></aside>
      <div className="reading-column">
        <header className="article-header"><h1>{study.title}</h1><p className="speaker">{study.speaker}</p>
          <div className="article-source-links">{study.source && <a href={study.source} target="_blank" rel="noreferrer">Rekaman kajian<ExternalLink size={13} /></a>}
            <span className={`verification-label ${study.state !== 'current' ? 'warning' : ''}`}><CircleHelp size={14} />{labels[study.state]}</span></div>
          {study.stats && <p className="review-summary">JEV memeriksa dukungan sumber untuk setiap poin. <a href="/tinjauan/">{study.stats.review} dari {study.stats.total} blok ditandai JEV</a>; {pendingReview} belum diterima pemilik. Buka <strong>Lihat bukti</strong> di samping poin untuk melihat hasilnya.</p>}
          {study.ownerReview.reviewedAt && <p className="review-summary">Pemilik meninjau catatan ini pada {new Date(study.ownerReview.reviewedAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}. Siap untuk belajar pribadi; bukan pengesahan kesahihan agama.</p>}
          {study.ownerReview.status === 'stale' && <p className="notice owner-review-warning">Tinjauan pemilik tidak berlaku untuk versi ini atau datanya rusak. <a href="/kelola/">Periksa ulang catatan</a> sebelum mengulang tinjauan; hasil JEV ditampilkan terpisah.</p>}
          {study.state !== 'current' && <p className="notice">{study.state === 'legacy' ? 'Catatan ini memakai format sebelumnya. Tautan waktu tetap dapat dibaca; rincian bukti akan tersedia setelah dibuat ulang.' : 'Hasil JEV belum berlaku untuk isi ini. Jalankan verifikasi kembali setelah mengedit catatan.'}</p>}
        </header>
        <div className="reading-toolbar" aria-label="Pengaturan baca">
          <Button ref={contentsTrigger} className="mobile-contents" variant="outline" size="sm" disabled={!ready} onClick={() => setContentsOpen(true)}><List size={16} />Daftar isi</Button>
          <div className="font-controls"><Button variant="ghost" size="icon" aria-label="Perkecil teks" disabled={!ready || state.fontSize <= 16} onClick={() => update(old => ({ ...old, fontSize: old.fontSize - 2 }))}><Minus size={15} /></Button><span aria-live="polite">Aa <span className="sr-only">{state.fontSize} piksel</span></span><Button variant="ghost" size="icon" aria-label="Perbesar teks" disabled={!ready || state.fontSize >= 22} onClick={() => update(old => ({ ...old, fontSize: old.fontSize + 2 }))}><Plus size={15} /></Button></div>
          <div className="toolbar-exports"><Button variant="ghost" size="sm" asChild><a href={`/unduh/${study.slug}.md`} download={study.filename} aria-label="Unduh Markdown"><Download size={15} /><span>Markdown</span></a></Button><Button variant="ghost" size="sm" aria-label="Cetak catatan" disabled={!ready} onClick={() => window.print()}><Printer size={15} /><span>Cetak</span></Button></div>
        </div>
        {storageError && <p className="notice" role="status">Penyimpanan browser tidak tersedia atau datanya rusak. Anda tetap dapat membaca; progres baru mungkin tidak tersimpan.</p>}
        {ready && resume && study.sections.some(s => s.id === resume) && <a className="resume-inline" href={'#' + resume}>Lanjutkan dari bagian terakhir dibaca <ArrowLeft size={14} style={{ transform: 'rotate(180deg)' }} /></a>}
        <article className="study-article" style={{ fontSize: state.fontSize }}>
          {study.sections.map(section => <section id={section.id} key={section.id} tabIndex={-1} className={section.level === 3 ? 'study-section subsection-content' : 'study-section'}>
            <div className="section-heading">{section.level === 2 ? <h2>{section.title}</h2> : <h3>{section.title}</h3>}
              <Button variant="ghost" size="icon" className="bookmark-button" aria-label={`${saved.includes(section.id) ? 'Hapus simpanan' : 'Simpan bagian'}: ${section.title}`} aria-pressed={saved.includes(section.id)} disabled={!ready} onClick={() => toggleBookmark(section.id)}><Bookmark size={17} fill={saved.includes(section.id) ? 'currentColor' : 'none'} /></Button>
            </div>
            {section.parts.map((part, i) => <div key={part.claimId || i} id={part.claimId ? `poin-${part.claimId}` : undefined} className={`study-point ${part.actionKey ? 'action-point' : ''} ${part.claim?.kind === 'quotation' ? 'quotation-point' : ''}`}>
              {part.actionKey && <Checkbox className="action-checkbox" id={`action-${part.actionKey}`} checked={!!actions[part.actionKey]} disabled={!ready} aria-label={`Tandai selesai: ${part.text.split('Sumber:')[0]}`} onCheckedChange={checked => update(old => ({ ...old, actions: { ...old.actions, [study.id]: { ...(old.actions[study.id] || {}), [part.actionKey!]: checked === true } } }))} />}
              <div className={part.actionKey && actions[part.actionKey] ? 'action-done' : ''}>
                <div className="markdown-content" dangerouslySetInnerHTML={{ __html: part.html }} />
                {part.claimId && <div className="claim-controls"><Button variant="ghost" size="sm" disabled={!ready} onClick={event => { trigger.current = event.currentTarget; setSelected(part); }}><PanelRightOpen size={14} />Lihat bukti</Button><span className={claimStatus(part.claim).includes('Didukung') || claimStatus(part.claim).includes('identik') ? 'claim-supported' : 'claim-review'}>{study.state === 'current' ? claimStatus(part.claim) : labels[study.state]}</span></div>}
              </div>
            </div>)}
          </section>)}
        </article>
        {actionParts.length > 0 && <div className="action-summary"><Check size={17} /><p>{actionParts.filter(p => actions[p.actionKey!]).length} dari {actionParts.length} saran penerapan ditandai selesai. Tersimpan di browser ini.</p></div>}
        {study.state === 'current' && study.ownerReview.status !== 'stale' && <section className="document-review" aria-label="Persetujuan catatan"><h2>Tinjauan seluruh catatan</h2>
          {pendingReview > 0 ? <p className="muted">Masih ada {pendingReview} poin yang perlu diterima setelah tinjauan sumber. <a href={`/tinjauan/#review-${study.slug}`}>Buka daftar tinjauan</a>.</p> : <ReviewControls slug={study.slug} revision={study.revision} reviewed={study.ownerReview.status === 'reviewed'} />}
          {study.ownerReview.status === 'reviewed' && <p className="muted">Catatan ini sudah ditinjau pemilik untuk versi saat ini.</p>}
        </section>}
        <div className="reading-end"><p>Selesai membaca bukan berarti selesai belajar.</p><span>Tinjau bagian yang belum jelas dan kembali ke rekaman saat diperlukan.</span><a className="text-link" href="/">Kembali ke perpustakaan<ArrowLeft size={15} /></a></div>
      </div>
      {wide && selected && <aside className="evidence-sidebar" ref={panel} tabIndex={-1} aria-label="Bukti dan sumber" onKeyDown={event => { if (event.key === 'Escape') closeEvidence(); }}><div className="evidence-title"><h2>Bukti & sumber</h2><Button size="icon" variant="ghost" aria-label="Tutup bukti" onClick={closeEvidence}><X size={18} /></Button></div><Evidence part={selected} study={study} /></aside>}
    </div>
    <Sheet open={!!selected && !wide} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent className="evidence-sheet" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}><SheetHeader><SheetTitle>Bukti & sumber</SheetTitle><SheetDescription>Kutipan, referensi tambahan, dan hasil pemeriksaan untuk poin ini.</SheetDescription></SheetHeader>{selected && <Evidence part={selected} study={study} />}</SheetContent></Sheet>
    <Sheet open={contentsOpen} onOpenChange={setContentsOpen}><SheetContent side="left" className="contents-sheet" onCloseAutoFocus={event => { event.preventDefault(); const target = contentsDestination.current ? document.getElementById(contentsDestination.current) : contentsTrigger.current; target?.focus({ preventScroll: true }); contentsDestination.current = null; }}><SheetHeader><SheetTitle>Dalam catatan ini</SheetTitle><SheetDescription>Pilih bagian untuk melanjutkan membaca.</SheetDescription></SheetHeader>{contents}</SheetContent></Sheet>
  </main>;
}
