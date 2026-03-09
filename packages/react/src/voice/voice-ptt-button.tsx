"use client";

import React, { type ReactNode } from "react";
import type { UseGlovePTTReturn } from "./use-glove-ptt";
import type { VoiceMode } from "glove-voice";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoicePTTButtonRenderProps {
  /** Whether the voice pipeline is enabled. */
  enabled: boolean;
  /** Whether the user is currently holding to record. */
  recording: boolean;
  /** Whether STT is finalizing after a short recording. */
  processing: boolean;
  /** Current voice pipeline state. */
  mode: VoiceMode;
}

export interface VoicePTTButtonProps {
  /** The return value of `useGlovePTT()`. */
  ptt: UseGlovePTTReturn;

  /**
   * Render prop for full styling control.
   *
   * @example
   * ```tsx
   * <VoicePTTButton ptt={ptt}>
   *   {({ enabled, recording, mode }) => (
   *     <button className={recording ? "active" : ""}>
   *       <MicIcon />
   *       {enabled && <StatusDot />}
   *     </button>
   *   )}
   * </VoicePTTButton>
   * ```
   */
  children: (props: VoicePTTButtonRenderProps) => ReactNode;

  /** Additional className on the wrapper span. */
  className?: string;

  /** Additional style on the wrapper span. */
  style?: React.CSSProperties;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Headless push-to-talk button component.
 *
 * Encapsulates click-vs-hold discrimination, pointer leave safety,
 * and aria attributes. The render prop gives full styling control.
 *
 * @example
 * ```tsx
 * import { VoicePTTButton } from "glove-react/voice";
 *
 * <VoicePTTButton ptt={ptt}>
 *   {({ enabled, recording, mode }) => (
 *     <button className={recording ? "recording" : ""}>
 *       <MicIcon />
 *     </button>
 *   )}
 * </VoicePTTButton>
 * ```
 */
export function VoicePTTButton({
  ptt,
  children,
  className,
  style,
}: VoicePTTButtonProps): ReactNode {
  const renderProps: VoicePTTButtonRenderProps = {
    enabled: ptt.enabled,
    recording: ptt.recording,
    processing: ptt.processing,
    mode: ptt.mode,
  };

  return (
    <span
      {...ptt.bind}
      role="button"
      tabIndex={0}
      aria-label={
        ptt.recording
          ? "Recording — release to send"
          : ptt.enabled
            ? "Hold to speak, click to disable voice"
            : "Click to enable voice"
      }
      aria-pressed={ptt.recording}
      className={className}
      style={{ ...style, touchAction: "none", userSelect: "none" }}
    >
      {children(renderProps)}
    </span>
  );
}
