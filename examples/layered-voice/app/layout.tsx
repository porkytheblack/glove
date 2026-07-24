import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Layered Voice Agents — Orbital Dynamics",
  description:
    "A layered voice-agent demo on Glove: a thin front agent that speaks via <speech> tags and a heavy worker over the mesh.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
