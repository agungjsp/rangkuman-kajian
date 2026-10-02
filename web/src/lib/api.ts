export async function api<T = any>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path, value === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '' },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Operasi gagal. Muat ulang halaman dan coba lagi.');
  return result;
}
