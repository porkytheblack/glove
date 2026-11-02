"use client";

import { useRouter } from "next/navigation";
import { Composer } from "glove-foundry-web-kit/client";
import { postJson } from "./api";

/** An ask that names no bot: it goes to the Primary Bot, and its chat opens. */
export function Ask({ disabled }: { readonly disabled: boolean }) {
  const router = useRouter();
  return (
    <Composer
      label="Ask your crew"
      placeholder="Ask your crew anything. Your Primary Bot takes it."
      disabled={disabled}
      onSend={async (text) => {
        const { botId } = await postJson<{ botId: string; runId: string }>("/api/ask", { text });
        router.push(`/bots/${botId}`);
      }}
    />
  );
}
