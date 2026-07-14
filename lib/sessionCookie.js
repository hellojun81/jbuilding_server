const allowedSameSiteValues = new Set(['Strict', 'Lax', 'None']);

export function buildSessionCookie(token, maxAge, env = process.env) {
  const configuredSameSite = String(env.SESSION_COOKIE_SAME_SITE || 'Lax');
  const sameSite = allowedSameSiteValues.has(configuredSameSite) ? configuredSameSite : 'Lax';
  const secure = env.SESSION_COOKIE_SECURE === 'true' || env.NODE_ENV === 'production';
  return `rent_session=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${Math.floor(maxAge / 1000)}${secure ? '; Secure' : ''}`;
}
