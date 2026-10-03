import { describe, expect, it, vi } from 'vitest';
import { csrfProtection, csrfToken, extractCsrfToken, generateCsrfToken, verifyCsrfToken } from '../../dashboard/middleware/csrf';
import { HttpError } from '../../dashboard/lib/errors';

function fakeReq(overrides: Record<string, unknown> = {}) {
  return { method: 'POST', path: '/guilds/1/settings', body: {}, headers: {}, query: {}, session: { csrfToken: 'tok-123' }, ...overrides } as never;
}
function run(mw: ReturnType<typeof csrfProtection>, req: unknown) {
  const next = vi.fn();
  mw(req as never, { locals: {} } as never, next);
  return next;
}

describe('verifyCsrfToken', () => {
  it('accepte un jeton identique', () => {
    expect(verifyCsrfToken('abc', 'abc')).toBe(true);
  });
  it('refuse un jeton différent, vide, absent ou non-string', () => {
    expect(verifyCsrfToken('abc', 'abd')).toBe(false);
    expect(verifyCsrfToken('abc', 'ab')).toBe(false);
    expect(verifyCsrfToken('abc', '')).toBe(false);
    expect(verifyCsrfToken(undefined, 'abc')).toBe(false);
    expect(verifyCsrfToken('abc', 123)).toBe(false);
    expect(verifyCsrfToken('abc', ['abc'])).toBe(false);
  });
  it('génère des jetons uniques et longs', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

describe('extractCsrfToken', () => {
  it('lit le champ caché _csrf en priorité', () => {
    expect(extractCsrfToken({ body: { _csrf: 'body' }, headers: { 'x-csrf-token': 'header' }, query: {} } as never)).toBe('body');
  });
  it('lit l’en-tête x-csrf-token', () => {
    expect(extractCsrfToken({ body: {}, headers: { 'x-csrf-token': 'header' }, query: {} } as never)).toBe('header');
    expect(extractCsrfToken({ body: undefined, headers: { 'x-csrf-token': ['h1', 'h2'] }, query: {} } as never)).toBe('h1');
  });
  it('renvoie undefined sans jeton', () => {
    expect(extractCsrfToken({ body: {}, headers: {}, query: {} } as never)).toBeUndefined();
  });
});

describe('csrfProtection middleware', () => {
  const mw = csrfProtection({ ignore: (req) => req.path.startsWith('/api/fivem') });

  it('laisse passer les méthodes sûres', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const next = run(mw, fakeReq({ method }));
      expect(next).toHaveBeenCalledWith();
    }
  });
  it('accepte une mutation avec champ _csrf valide', () => {
    const next = run(mw, fakeReq({ body: { _csrf: 'tok-123' } }));
    expect(next).toHaveBeenCalledWith();
  });
  it('accepte une mutation avec en-tête valide', () => {
    const next = run(mw, fakeReq({ headers: { 'x-csrf-token': 'tok-123' } }));
    expect(next).toHaveBeenCalledWith();
  });
  it('rejette (403) une mutation sans jeton ou avec un mauvais jeton', () => {
    for (const req of [fakeReq(), fakeReq({ body: { _csrf: 'wrong' } }), fakeReq({ headers: { 'x-csrf-token': 'wrong' } }), fakeReq({ session: {} , body: { _csrf: 'tok-123' } })]) {
      const next = run(mw, req);
      const err = next.mock.calls[0][0] as unknown;
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
    }
  });
  it('ignore les chemins exemptés (API sans session)', () => {
    const next = run(mw, fakeReq({ path: '/api/fivem/servers/1/abc/status', session: undefined }));
    expect(next).toHaveBeenCalledWith();
  });
  it('rejette DELETE et PUT sans jeton', () => {
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const next = run(mw, fakeReq({ method }));
      expect((next.mock.calls[0][0] as HttpError).status).toBe(403);
    }
  });
});

describe('csrfToken middleware', () => {
  it('crée le jeton en session et l’expose aux vues', () => {
    const req = { session: {} as { csrfToken?: string } };
    const res = { locals: {} as { csrfToken?: string } };
    const next = vi.fn();
    csrfToken()(req as never, res as never, next);
    expect(req.session.csrfToken).toBeTruthy();
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(next).toHaveBeenCalled();
  });
  it('réutilise un jeton existant', () => {
    const req = { session: { csrfToken: 'keep' } };
    const res = { locals: {} as { csrfToken?: string } };
    csrfToken()(req as never, res as never, vi.fn());
    expect(res.locals.csrfToken).toBe('keep');
  });
});
