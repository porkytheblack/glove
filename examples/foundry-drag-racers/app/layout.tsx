import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paddock Line · Glove Foundry",
  description: "Talk live with three fictional drag racers powered by Gemini Live and Glove Foundry.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
