import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is missing. Keep the local Convex process running.",
    );
  }
  return new ConvexHttpClient(url);
}

export { api };
