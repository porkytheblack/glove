"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GloveClient } from "../client";

const GloveClientContext = createContext<GloveClient | null>(null);

/**
 * Provides a `GloveClient` to the component tree.
 *
 * ```tsx
 * import { GloveClient, GloveProvider } from "glove-react";
 *
 * const client = new GloveClient({ endpoint: "/api/chat" });
 *
 * <GloveProvider client={client}>
 *   <App />
 * </GloveProvider>
 * ```
 *
 * Any `useGlove()` call inside the tree reads the client from this provider.
 */
export function GloveProvider({
  client,
  children,
}: {
  client: GloveClient;
  children: ReactNode;
}) {
  return (
    <GloveClientContext.Provider value={client}>
      {children}
    </GloveClientContext.Provider>
  );
}

/**
 * Returns the `GloveClient` from the nearest `GloveProvider`, or `null` if none.
 *
 * @internal Used by `useGlove` to resolve store/model from context.
 */
export function useGloveClient(): GloveClient | null {
  return useContext(GloveClientContext);
}
