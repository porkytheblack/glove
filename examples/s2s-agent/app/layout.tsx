import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glove S2S Agent",
  description:
    "A Glove agent running on speech-to-speech models via RealtimeAgent — OpenAI Realtime (device mode) and Gemini Live (transport mode).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
