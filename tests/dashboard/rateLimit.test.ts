import { afterEach, describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../../dashboard/lib/rateLimit';

describe('SlidingWindowRateLimiter', () => {
  const limiter = new SlidingWindowRateLimiter(1000, 3);
  afterEach(() => limiter.reset());

  it('autorise jusqu’au maximum puis bloque', () => {
    const t = 10_000;
    expect(limiter.check('ip', t).allowed).toBe(true);
    expect(limiter.check('ip', t + 1).allowed).toBe(true);
    expect(limiter.check('ip', t + 2).allowed).toBe(true);
    const blocked = limiter.check('ip', t + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
  it('libère après la fenêtre glissante', () => {
    const t = 10_000;
    for (let i = 0; i < 3; i++) limiter.check('ip', t + i);
    expect(limiter.check('ip', t + 500).allowed).toBe(false);
    expect(limiter.check('ip', t + 1001).allowed).toBe(true);
  });
  it('isole les clés', () => {
    const t = 10_000;
    for (let i = 0; i < 3; i++) limiter.check('a', t + i);
    expect(limiter.check('b', t).allowed).toBe(true);
  });
  limiter.stop();
});
