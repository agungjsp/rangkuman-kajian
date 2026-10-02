import { useEffect, useId, useState } from 'react';
import { Button } from './ui/button';
import { api } from '../lib/api';

type Props = { slug: string; revision?: string; claimId?: string; accepted?: boolean; reviewed?: boolean; reopenEvidence?: boolean };
export default function ReviewControls({ slug, revision, claimId, accepted, reviewed, reopenEvidence }: Props) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState('');
  const id = `review-${slug}-${claimId || 'document'}-${useId()}`;
  useEffect(() => setReady(true), []);
  if (!revision) return <p className="small muted">Transkrip lokal yang sesuai diperlukan untuk menyimpan tinjauan.</p>;
  if (!claimId && reviewed) return null;
  return <form className="review-controls" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/api/studies/${encodeURIComponent(slug)}/review`, { action: claimId ? accepted ? 'unaccept' : 'accept' : 'approve',
        claim_id: claimId, reason, attested, revision });
      if (claimId && reopenEvidence) {
        const url = new URL(window.location.href); url.searchParams.set('bukti', claimId); url.hash = `poin-${claimId}`;
        window.location.assign(url.href);
      } else window.location.reload();
    } catch (error) { setError(error instanceof Error ? error.message : 'Tinjauan gagal disimpan.'); setBusy(false); }
  }}>
    {claimId ? !accepted && <><label htmlFor={id}>Alasan penerimaan berdasarkan sumber</label><textarea id={id} required maxLength={10000} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /><p className="small muted">Baca kutipan dan konteks sebelum menerima poin. Temuan JEV tetap ditampilkan.</p></> :
      <label className="attestation"><input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} disabled={busy} /><span>Saya telah meninjau seluruh catatan, sumber, cakupan materi dan tanya jawab, serta label ketidakpastian. Catatan ini siap untuk belajar pribadi.</span></label>}
    {error && <p className="notice" role="alert">{error} <a href={typeof window === 'undefined' ? '' : window.location.href}>Muat ulang halaman</a></p>}
    <Button type="submit" variant={claimId ? 'outline' : 'default'} size="sm" disabled={!ready || busy || (claimId ? !accepted && !reason.trim() : !attested)}>
      {busy ? 'Menyimpan tinjauan…' : claimId ? accepted ? 'Buka kembali poin' : 'Terima setelah tinjauan sumber' : 'Setujui catatan untuk belajar'}
    </Button>
  </form>;
}
