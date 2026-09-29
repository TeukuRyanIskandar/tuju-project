import { can, TIER_ALLOWED_JOBS } from './tier-policy';

/**
 * Capability map unit test (ADR-0005). Asserts the two invariants hold at the
 * `can()` seam: free enqueues nothing; pro/premium may run TA + FA.
 */
describe('tier-policy can()', () => {
  it('free tier can run NO jobs', () => {
    expect(TIER_ALLOWED_JOBS.free).toEqual([]);
    expect(can({ tier: 'free' }, 'analyze-technical')).toBe(false);
    expect(can({ tier: 'free' }, 'analyze-fundamental')).toBe(false);
  });

  it('pro tier can run TA and FA', () => {
    expect(can({ tier: 'pro' }, 'analyze-technical')).toBe(true);
    expect(can({ tier: 'pro' }, 'analyze-fundamental')).toBe(true);
  });

  it('premium tier can run TA and FA (Product C adds more additively)', () => {
    expect(can({ tier: 'premium' }, 'analyze-technical')).toBe(true);
    expect(can({ tier: 'premium' }, 'analyze-fundamental')).toBe(true);
  });

  it('an undefined user (anonymous) can run no jobs', () => {
    expect(can(undefined, 'analyze-technical')).toBe(false);
  });
});
