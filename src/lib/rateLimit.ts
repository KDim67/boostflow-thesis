/**
 * Simple in-memory rate limiter for API routes.
 * Useful for environments without Redis, though state will reset on server restarts/serverless cold starts.
 */
interface RateLimitTracker {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitTracker>();

/**
 * Checks if a given identifier (e.g., IP address) has exceeded the rate limit.
 *
 * @param identifier The unique key to rate limit by (usually IP address)
 * @param limit Maximum number of requests allowed within the window
 * @param windowMs Time window in milliseconds
 * @returns boolean True if the request is allowed, false if rate limited
 */
export function isRateLimited(
  identifier: string,
  limit: number = 5,
  windowMs: number = 60000 // default 1 minute
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();
  const tracker = rateLimitStore.get(identifier);

  // Clean up expired entries occasionally (could be optimized, but fine for simple use)
  if (rateLimitStore.size > 1000) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) rateLimitStore.delete(key);
    }
  }

  if (!tracker || tracker.resetTime < now) {
    // First request or window expired
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: now + windowMs,
    };
  }

  // Window still active
  if (tracker.count >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      reset: tracker.resetTime,
    };
  }

  tracker.count += 1;
  return {
    success: true,
    limit,
    remaining: limit - tracker.count,
    reset: tracker.resetTime,
  };
}
