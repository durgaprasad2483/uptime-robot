export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    redirect: 'manual', // an expired Access session answers with a redirect to the login page
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.type === 'opaqueredirect') { location.reload(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}
