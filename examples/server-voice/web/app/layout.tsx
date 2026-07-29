import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbital Dynamics · rooms",
  description: "Server-side voice: the browser is an audio duct.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
