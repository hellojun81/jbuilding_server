import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionCookie } from '../lib/sessionCookie.js';

test('uses a local-development cookie by default', () => {
  assert.equal(
    buildSessionCookie('token', 8000, {}),
    'rent_session=token; HttpOnly; SameSite=Lax; Path=/; Max-Age=8',
  );
});

test('supports secure cross-site cookies for an HTTPS frontend', () => {
  assert.equal(
    buildSessionCookie('token', 8000, {
      SESSION_COOKIE_SAME_SITE: 'None',
      SESSION_COOKIE_SECURE: 'true',
    }),
    'rent_session=token; HttpOnly; SameSite=None; Path=/; Max-Age=8; Secure',
  );
});
