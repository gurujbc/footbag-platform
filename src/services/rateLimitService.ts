export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function now(): number {
  return Date.now();
}

export function hit(
  key: string,
  maxAttempts: number,
  windowMinutes: number,
): RateLimitResult {
  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be >= 1');
  }
  if (windowMinutes <= 0) {
    throw new Error('windowMinutes must be > 0');
  }

  const windowMs = windowMinutes * 60 * 1000;
  const t = now();
  const bucket = buckets.get(key);

  if (!bucket || t - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: t });
    return { allowed: true };
  }

  if (bucket.count < maxAttempts) {
    bucket.count += 1;
    return { allowed: true };
  }

  const retryAfterMs = bucket.windowStart + windowMs - t;
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return { allowed: false, retryAfterSeconds };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}

