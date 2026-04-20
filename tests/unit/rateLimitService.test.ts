import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  hit,
  resetRateLimitForTests,
} from '../../src/services/rateLimitService';

beforeEach(() => {
  resetRateLimitForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimitService.hit', () => {
  it('allows the first hit', () => {
    const r = hit('k1', 3, 5);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSeconds).toBeUndefined();
  });

  it('allows hits up to maxAttempts within the window', () => {
    expect(hit('k', 3, 5).allowed).toBe(true);
    expect(hit('k', 3, 5).allowed).toBe(true);
    expect(hit('k', 3, 5).allowed).toBe(true);
  });

  it('blocks the N+1 hit within the window and reports retryAfterSeconds', () => {
    for (let i = 0; i < 5; i++) hit('k', 5, 1);
    const blocked = hit('k', 5, 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('resets the window after windowMinutes elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    for (let i = 0; i < 3; i++) hit('k', 3, 5);
    expect(hit('k', 3, 5).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-04-17T12:05:01Z'));
    const afterWindow = hit('k', 3, 5);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.retryAfterSeconds).toBeUndefined();
  });

  it('tracks keys independently', () => {
    for (let i = 0; i < 3; i++) hit('a', 3, 5);
    expect(hit('a', 3, 5).allowed).toBe(false);
    expect(hit('b', 3, 5).allowed).toBe(true);
  });

  it('resetRateLimitForTests clears all buckets', () => {
    for (let i = 0; i < 3; i++) hit('k', 3, 5);
    expect(hit('k', 3, 5).allowed).toBe(false);
    resetRateLimitForTests();
    expect(hit('k', 3, 5).allowed).toBe(true);
  });

  it('rejects invalid maxAttempts', () => {
    expect(() => hit('k', 0, 5)).toThrow();
    expect(() => hit('k', -1, 5)).toThrow();
  });

  it('rejects invalid windowMinutes', () => {
    expect(() => hit('k', 3, 0)).toThrow();
    expect(() => hit('k', 3, -5)).toThrow();
  });
});
