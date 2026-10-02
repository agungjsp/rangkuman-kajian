import type { APIRoute } from 'astro';
import { ApiError, body, endpoint, python } from '../../../../lib/server';
export const POST: APIRoute = ({ request, params }) => endpoint(async () => {
  const data = await body(request);
  if (!['accept', 'unaccept', 'approve'].includes(data.action)) throw new ApiError('Tindakan tinjauan tidak dikenal.');
  const catalog = await python({ action: 'transcripts' });
  const matches = catalog.filter((item: { slug?: string }) => item.slug === params.id);
  if (matches.length !== 1) throw new ApiError('Transkrip untuk catatan ini tidak ditemukan atau bertabrakan.', 409);
  return python({ action: data.action, transcript_id: matches[0].id, revision: data.revision,
    claim_id: data.claim_id, reason: data.reason, attested: data.attested });
});
