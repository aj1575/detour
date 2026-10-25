import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// Agents retry on their own, so a stuck loop must not flood a trip with votes or photos.
export const limits = new RateLimiter(components.rateLimiter, {
  vote: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 10 },
  photo: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 30 },
});
