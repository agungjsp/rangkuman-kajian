import type { APIRoute } from 'astro';
import { body, endpoint, python } from '../../lib/server';
export const GET = () => endpoint(() => python({ action: 'transcripts' }));
export const POST: APIRoute = ({ request }) => endpoint(async () => {
  const { filename, content } = await body(request);
  return python({ action: 'import', filename, content });
}, 201);
