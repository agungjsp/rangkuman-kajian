import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { api } from '../lib/api';

type Transcript = { id: string; filename: string; title: string; source?: string; format?: string; passages?: number;
  error?: string; has_summary?: boolean; slug?: string; revision?: string; commands?: { draft: string; verify: string } };
type Job = { id: string; transcript_id?: string; filename: string; origin: string; operation: 'draft' | 'verify';
  status: string; stage: string; started_at: string; completed?: number; total?: number; error?: string; slug?: string };
type Status = { python: boolean; codex: boolean; typesafe: boolean; busy: boolean; active?: Job };
const stages: Record<string, string> = { parsing: 'Membaca transkrip', analysis: 'Menganalisis topik', extraction: 'Mencatat rujukan',
  references: 'Mengambil referensi', drafting: 'Menulis draf', resuming: 'Melanjutkan draf tersimpan', verification: 'Memeriksa bukti', saving: 'Menyimpan catatan', complete: 'Catatan tersimpan' };
const outcomes: Record<string, string> = { running: 'Berjalan', succeeded: 'Selesai', failed: 'Gagal', interrupted: 'Terhenti' };
const date = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};

export default function Management() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<Status>();
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [copied, setCopied] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const item = transcripts.find(item => item.id === selected);
  const busy = working || !!status?.busy;

  const refresh = async () => {
    const [list, activity, history] = await Promise.all([api<Transcript[]>('/api/transcripts'), api<Status>('/api/status'), api<Job[]>('/api/jobs')]);
    setTranscripts(list); setStatus(activity); setJobs(history); setLoaded(true);
    setSelected(current => current && list.some(item => item.id === current) ? current : list[0]?.id || '');
    return activity;
  };
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 10000;
      try { const activity = await refresh(); if (activity.busy) delay = 2000; }
      catch (error) { if (!stopped) setError(error instanceof Error ? error.message : 'Server tidak dapat dihubungi.'); }
      if (!stopped) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [status?.busy]);
  useEffect(() => { setReplace(false); setCopied(''); }, [selected]);

  const start = async (transcript: Transcript, operation: 'draft' | 'verify', replacing = false) => {
    if (!transcript.revision) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const job = await api<Job>('/api/jobs', { transcript_id: transcript.id, operation, revision: transcript.revision, replace: replacing });
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]);
      setStatus(previous => previous ? { ...previous, busy: true, active: job } : previous);
      setNotice('Proses dimulai. Anda boleh meninggalkan halaman ini dan kembali nanti.');
      setReplace(false);
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Proses gagal dimulai.'); }
    finally { setWorking(false); }
  };

  return <main id="main" className="manage-main">
    <header className="manage-intro"><h1>Kelola rangkuman</h1><p>Tambahkan transkrip, buat catatan, lalu tinjau bukti di ruang baca. Perintah terminal memakai proses dan berkas yang sama.</p></header>
    <div className="manage-status">
      <p>{!loaded ? 'Memeriksa kesiapan proses lokal…' : status?.busy ? 'Satu proses sedang berjalan. Tunggu sebelum memulai tindakan lain.' : 'Proses lokal siap menerima satu tugas.'}</p>
      <Button variant="ghost" size="sm" disabled={working} onClick={async () => { setError(''); try { await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Server tidak tersedia.'); } }}>Muat ulang daftar</Button>
    </div>
    {status?.active && <p className="manage-feedback" aria-live="polite"><strong>{stages[status.active.stage] || status.active.stage}</strong> · {status.active.filename}{status.active.total != null && status.active.completed != null ? ` · ${status.active.completed}/${status.active.total}` : ''}</p>}
    {loaded && (!status?.typesafe || !status.codex) && <div className="notice"><strong>Persiapan untuk membuat rangkuman</strong>
      {!status?.typesafe && <p>Atur <code>TYPESAFE_API_KEY</code> pada terminal yang menjalankan server, lalu mulai ulang server. Kunci tidak dimasukkan melalui browser.</p>}
      {!status?.codex && <p>Codex CLI belum ditemukan pada PATH server. Pasang dan masuk melalui terminal sebelum membuat draf.</p>}
      <p>Codex memakai sesi masuk pada komputer ini. Ketersediaan program belum memastikan sesi masuk atau kuota layanan. Membaca dan meninjau catatan tetap tersedia.</p>
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="manage-feedback" role="status">{notice}</p>}
    <section className="manage-section" aria-labelledby="transcripts-heading">
      <h2 id="transcripts-heading">Transkrip Anda</h2>
      {!loaded ? <p className="muted">Memuat transkrip…</p> : !transcripts.length ? <p className="muted">Belum ada transkrip. Unggah berkas atau tempel teks di bawah.</p> : <div className="manage-workspace">
        <fieldset className="transcript-list"><legend className="sr-only">Pilih transkrip</legend>{transcripts.map(transcript => <label key={transcript.id} className={selected === transcript.id ? 'selected' : ''}>
          <input type="radio" name="transcript" value={transcript.id} checked={selected === transcript.id} onChange={() => setSelected(transcript.id)} />
          <span><strong>{transcript.title}</strong><small>{transcript.filename}</small><small>{transcript.error ? 'Perlu diperbaiki' : transcript.has_summary ? 'Catatan tersedia' : 'Belum dirangkum'}</small></span>
        </label>)}</fieldset>
        {item && <div className="transcript-detail">
          <h3>{item.title}</h3>
          {item.error ? <p className="notice">{item.error}</p> : <>
            <p className="muted">{item.format === 'timestamped' ? 'Transkrip dengan waktu' : 'Teks tanpa waktu'} · {item.passages} bagian</p>
            {item.source && <a className="text-link" href={item.source} target="_blank" rel="noreferrer">Buka sumber rekaman</a>}
            <div className="manage-actions">
              {!item.has_summary ? <Button disabled={busy || !status?.typesafe || !status.codex} onClick={() => start(item, 'draft')}>Buat rangkuman</Button> : <>
                <Button asChild><a href={`/kajian/${item.slug}/`}>Buka catatan</a></Button>
                <Button variant="outline" disabled={busy || !status?.typesafe} onClick={() => {
                  if (window.confirm('Pemeriksaan ulang akan menghapus penerimaan dan persetujuan pemilik setelah berhasil. Lanjutkan?')) void start(item, 'verify');
                }}>Periksa ulang</Button>
              </>}
            </div>
            {item.has_summary && <details className="regenerate"><summary>Buat ulang rangkuman</summary>
              <p>Isi dan suntingan saat ini akan diganti setelah proses berhasil. Versi sebelumnya diarsipkan dan tinjauan pemilik dimulai kembali.</p>
              <label className="attestation"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /><span>Saya memahami penggantian isi dan pengulangan tinjauan.</span></label>
              <Button variant="outline" disabled={busy || !replace || !status?.typesafe || !status.codex} onClick={() => start(item, 'draft', true)}>Buat ulang dan arsipkan versi lama</Button>
            </details>}
            <details className="terminal-alternative"><summary>Gunakan perintah terminal</summary><p>Jalankan dari direktori proyek.</p>
              {(['draft', ...(item.has_summary ? ['verify'] : [])] as ('draft' | 'verify')[]).map(operation => <div key={operation}>
                <pre><code>{item.commands?.[operation]}</code></pre><Button variant="ghost" size="sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(item.commands?.[operation] || ''); setCopied(operation); }
                  catch { setError('Penyalinan tidak tersedia. Pilih dan salin teks perintah secara manual.'); }
                }}>{copied === operation ? 'Perintah disalin' : operation === 'draft' ? 'Salin perintah draf' : 'Salin perintah pemeriksaan'}</Button>
              </div>)}
            </details>
          </>}
        </div>}
      </div>}
    </section>
    <section className="manage-section" aria-labelledby="import-heading">
      <h2 id="import-heading">Tambahkan transkrip</h2><p className="muted">Teks UTF-8, maksimum 2 MiB. Transkrip diperiksa sebelum disimpan; belum ada panggilan AI.</p>
      <form className="import-form" onSubmit={async event => {
        event.preventDefault(); setWorking(true); setError(''); setNotice('');
        try {
          let bytes: Uint8Array, filename: string;
          if (mode === 'file') {
            const upload = file.current?.files?.[0];
            if (!upload) throw new Error('Pilih berkas .md atau .txt.');
            if (upload.size > 2 * 1024 * 1024) throw new Error('Transkrip melebihi batas 2 MiB.');
            bytes = new Uint8Array(await upload.arrayBuffer());
            try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Berkas harus menggunakan UTF-8.'); }
            filename = upload.name;
          } else {
            if (!title.trim() || !text.trim()) throw new Error('Judul dan isi transkrip diperlukan.');
            filename = title.trim().replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, '-').slice(0, 100) + '.txt';
            bytes = new TextEncoder().encode(`title: ${title.trim()}\n${source.trim() ? `source: ${source.trim()}\n` : ''}\n${text}`);
            if (bytes.length > 2 * 1024 * 1024) throw new Error('Transkrip melebihi batas 2 MiB.');
          }
          const imported = await api<Transcript>('/api/transcripts', { filename, content: encode(bytes) });
          await refresh(); setSelected(imported.id); setText(''); setTitle(''); setSource('');
          if (file.current) file.current.value = '';
          setNotice(`Transkrip diperiksa dan disimpan: ${imported.title}, ${imported.passages} bagian. Pilih Buat rangkuman untuk memulai.`);
          document.getElementById('transcripts-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) { setError(error instanceof Error ? error.message : 'Transkrip gagal disimpan.'); }
        finally { setWorking(false); }
      }}>
        <fieldset className="input-modes"><legend>Cara menambahkan</legend><label><input type="radio" name="mode" checked={mode === 'file'} onChange={() => setMode('file')} /> Unggah berkas</label><label><input type="radio" name="mode" checked={mode === 'paste'} onChange={() => setMode('paste')} /> Tempel teks</label></fieldset>
        {mode === 'file' ? <label>Berkas transkrip<input ref={file} type="file" accept=".md,.txt,text/plain,text/markdown" required disabled={busy} /></label> : <>
          <label>Judul kajian<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required disabled={busy} /></label>
          <label>URL sumber (opsional)<input type="url" value={source} onChange={event => setSource(event.target.value)} disabled={busy} /></label>
          <label>Isi transkrip<textarea rows={8} value={text} onChange={event => setText(event.target.value)} required disabled={busy} /></label>
        </>}
        <Button type="submit" variant="outline" disabled={!loaded || busy}>{working ? 'Memproses…' : 'Periksa dan simpan transkrip'}</Button>
      </form>
    </section>
    <section className="manage-section" aria-labelledby="jobs-heading"><h2 id="jobs-heading">Riwayat proses</h2>
      {!loaded ? <p className="muted">Memuat riwayat…</p> : !jobs.length ? <p className="muted">Belum ada proses yang tercatat. Proses dari website dan perintah terminal akan tampil di sini.</p> : <ol className="job-list">{jobs.slice(0, 30).map(job => {
        const transcript = transcripts.find(item => item.id === job.transcript_id);
        return <li key={job.id}>
          <div className="job-heading"><strong>{job.filename}</strong><span>{outcomes[job.status] || job.status}</span></div>
          <p className="small muted">{job.operation === 'draft' ? 'Pembuatan draf' : 'Pemeriksaan bukti'} · {job.origin === 'website' ? 'Website' : 'Perintah terminal'} · {date(job.started_at)} WIB</p>
          <p className="job-progress" aria-live={job.status === 'running' ? 'polite' : 'off'}>{stages[job.stage] || job.stage}{job.total !== undefined && job.total !== null && job.completed !== undefined && job.completed !== null ? ` · ${job.completed}/${job.total}` : ''}</p>
          {job.error && <p className="notice">{job.error}</p>}
          {job.status === 'succeeded' && job.slug && <div className="manage-actions"><a className="text-link" href={`/kajian/${job.slug}/`}>Buka catatan</a><a className="text-link" href={`/tinjauan/#review-${job.slug}`}>Tinjau bukti</a></div>}
          {['failed', 'interrupted'].includes(job.status) && transcript && !transcript.error && <Button variant="outline" size="sm" disabled={busy || !status?.typesafe || job.operation === 'draft' && !status.codex} onClick={() => {
            if (transcript.has_summary && !window.confirm('Proses yang berhasil akan memperbarui catatan dan mengulang tinjauan pemilik. Lanjutkan?')) return;
            void start(transcript, job.operation, job.operation === 'draft' && transcript.has_summary);
          }}>Coba lagi</Button>}
        </li>;
      })}</ol>}
    </section>
  </main>;
}
