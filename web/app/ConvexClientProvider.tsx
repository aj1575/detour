"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold">Local Convex is not running</h1>
        <p className="mt-3">
          From the web folder, start <code>npx convex dev</code> and leave it open, then refresh.
        </p>
      </main>
    );
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
