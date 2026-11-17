export class AuthError extends Error {}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError(await res.text());
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}
