import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Layered Voice Agents — Orbital Dynamics",
  description:
    "A layered voice-agent demo on Glove: a thin front agent, a heavy worker over the mesh, and an addressing monitor that tells who is talking to whom.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
