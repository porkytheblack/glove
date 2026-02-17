import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

const siteUrl = "https://glove.dev";
const description = "Agentic runtime for building applications as conversations.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Glove",
    template: "%s | Glove",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "Glove",
    title: "Glove",
    description,
    url: siteUrl,
    images: [
      {
        url: "/og-data.png",
        width: 1200,
        height: 630,
        alt: "Glove — Agentic runtime for building applications as conversations",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Glove",
    description,
    images: ["/og-data.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
