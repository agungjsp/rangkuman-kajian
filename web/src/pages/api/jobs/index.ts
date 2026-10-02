import type { APIRoute } from 'astro';
import { ApiError, body, endpoint, python } from '../../../lib/server';
export const GET = () => endpoint(() => python({ action: 'jobs' }));
export const POST: APIRoute = ({ request }) => endpoint(async () => {
  const data = await body(request);
  if (!['draft', 'verify'].includes(data.operation)) throw new ApiError('Operasi tidak dikenal.');
  return python({ action: data.operation, transcript_id: data.transcript_id, revision: data.revision, replace: data.replace === true }, true);
}, 202);
