import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Braind Storm · Agentic brand workforce",
  description: "A Glove Foundry workforce for brand creation, go-to-market, image exploration, and review.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
