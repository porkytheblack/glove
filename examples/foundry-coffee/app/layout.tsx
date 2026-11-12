import type { Metadata } from "next";
import "./globals.css";
import "./foundry.css";

export const metadata: Metadata = {
  title: "Glove Coffee on Foundry",
  description: "The coffee example as a Foundry app, with Scribe v3 Live voice",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
