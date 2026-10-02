import type { APIRoute } from 'astro';
import { ApiError, endpoint, python } from '../../../lib/server';
export const GET: APIRoute = ({ params }) => endpoint(async () => {
  if (!/^[a-f0-9]{32}$/.test(params.id || '')) throw new ApiError('Proses tidak ditemukan.', 404);
  const job = (await python({ action: 'jobs' })).find((record: { id: string }) => record.id === params.id);
  if (!job) throw new ApiError('Proses tidak ditemukan.', 404);
  return job;
});
