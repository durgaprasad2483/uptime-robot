import type { Context, Next } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE = 'pulse_session';
const MAX_AGE = 30 * 86_400; // seconds

type C = Context<{ Bindings: Env }>;

/** The password doubles as the cookie-signing key, so changing it logs out every session. */
const secret = (c: C) => (c.env.ADMIN_PASSWORD?.length >= 16 ? c.env.ADMIN_PASSWORD : null);
const NOT_SET = 'Set the ADMIN_PASSWORD secret (16+ characters): npx wrangler secret put ADMIN_PASSWORD';

async function sameText(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function login(c: C) {
  const key = secret(c);
  if (!key) return c.text(NOT_SET, 500);
  const { password } = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  if (typeof password !== 'string' || !(await sameText(password, key))) return c.text('Wrong password', 401);
  await setSignedCookie(c, COOKIE, String(Date.now() + MAX_AGE * 1000), key, {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: MAX_AGE,
  });
  return c.body(null, 204);
}

export function logout(c: C) {
  deleteCookie(c, COOKIE, { path: '/', secure: true });
  return c.body(null, 204);
}

export async function requireAuth(c: C, next: Next) {
  const key = secret(c);
  if (!key) return c.text(NOT_SET, 500);
  const exp = Number(await getSignedCookie(c, key, COOKIE));
  if (!(exp > Date.now())) return c.text('Login required', 401);
  await next();
}
