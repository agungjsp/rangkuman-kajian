import { getStudies } from '../../lib/content';
import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ params }) => {
  const study = getStudies().find(study => study.slug === params.slug);
  return new Response(study?.markdown || 'Catatan tidak ditemukan.', { status: study ? 200 : 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
