"use client";

import { GloveProvider } from "glove-react";
import { gloveClient } from "./lib/glove";

export function Providers({ children }: { children: React.ReactNode }) {
  return <GloveProvider client={gloveClient}>{children}</GloveProvider>;
}
