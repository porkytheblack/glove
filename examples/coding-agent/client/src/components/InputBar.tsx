import { useState, useRef, useEffect, useCallback } from "react";

/** Staged image ready to be sent with the message */
interface StagedImage {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  mediaType: string;
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

export function InputBar({
  onSubmit,
  onAbort,
  busy,
  connected,
}: {
  onSubmit: (
    text: string,
    images?: Array<{ data: string; media_type: string }>,
  ) => void;
  onAbort: () => void;
  busy: boolean;
  connected: boolean;
}) {
  const [value, setValue] = useState("");
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the agent finishes processing
  useEffect(() => {
    if (!busy && inputRef.current) {
      inputRef.current.focus();
    }
  }, [busy]);

  // Auto-resize textarea to fit content (up to a max)
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const newImages: StagedImage[] = [];

    for (const file of fileArr) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_SIZE) continue;

      const base64 = await fileToBase64(file);
      newImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        base64,
        mediaType: file.type,
      });
    }

    if (newImages.length > 0) {
      setStagedImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setStagedImages((prev) => {
      const removed = prev.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text && stagedImages.length === 0) return;
    if (busy || !connected) return;

    const images =
      stagedImages.length > 0
        ? stagedImages.map((img) => ({
            data: img.base64,
            media_type: img.mediaType,
          }))
        : undefined;

    onSubmit(text || "(see attached images)", images);
    setValue("");
    // Clean up preview URLs
    stagedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setStagedImages([]);
  }, [value, stagedImages, busy, connected, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving the actual container (not children)
    if (e.currentTarget === e.target) {
      setDragActive(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  // Paste handler for clipboard images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      processFiles(imageFiles);
    }
  };

  const canSubmit = connected && !busy && (value.trim() || stagedImages.length > 0);

  return (
    <div
      className={`input-bar ${dragActive ? "input-bar-drag-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Staged image previews */}
      {stagedImages.length > 0 && (
        <div className="staged-images">
          {stagedImages.map((img) => (
            <div key={img.id} className="staged-image">
              <img
                src={img.previewUrl}
                alt={img.file.name}
                className="staged-image-preview"
              />
              <button
                className="staged-image-remove"
                onClick={() => removeImage(img.id)}
                aria-label={`Remove ${img.file.name}`}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3.05 3.05a.5.5 0 0 1 .7 0L6 5.29l2.25-2.24a.5.5 0 0 1 .7.7L6.71 6l2.24 2.25a.5.5 0 0 1-.7.7L6 6.71 3.75 8.95a.5.5 0 0 1-.7-.7L5.29 6 3.05 3.75a.5.5 0 0 1 0-.7z" />
                </svg>
              </button>
              <span className="staged-image-name">{img.file.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="input-row">
        {/* Attach button */}
        <button
          className="input-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image (or paste / drag-drop)"
          aria-label="Attach image"
          disabled={!connected}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 0 1-5-5l6.5-6.5a2.12 2.12 0 0 1 3 3L6.5 12a.71.71 0 0 1-1-1L11 5.5" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          className="input-file-hidden"
          onChange={(e) => {
            if (e.target.files) processFiles(e.target.files);
            e.target.value = ""; // Reset so same file can be re-selected
          }}
        />

        <textarea
          ref={inputRef}
          className="input-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            !connected
              ? "Disconnected..."
              : busy
                ? "Processing..."
                : "Message the agent... (Enter to send, Shift+Enter for newline)"
          }
          disabled={!connected}
          rows={1}
        />

        {busy ? (
          <button className="abort-btn" onClick={onAbort} title="Stop (Esc)">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
            <span>Stop</span>
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
            title="Send message (Enter)"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.724 1.053a.5.5 0 0 1 .552-.052l12 6.5a.5.5 0 0 1 0 .898l-12 6.5A.5.5 0 0 1 1.5 14.5v-5a.5.5 0 0 1 .4-.49L8 8l-6.1-.91A.5.5 0 0 1 1.5 6.5v-5a.5.5 0 0 1 .224-.447z" />
            </svg>
          </button>
        )}
      </div>

      {/* Keyboard hint */}
      <div className="input-hints">
        <span className="dim">
          <kbd>Enter</kbd> send
          {" \u00B7 "}
          <kbd>Shift+Enter</kbd> newline
          {" \u00B7 "}
          <kbd>Esc</kbd> abort
        </span>
      </div>

      {/* Drag overlay */}
      {dragActive && (
        <div className="input-drag-overlay">
          <span>Drop images here</span>
        </div>
      )}
    </div>
  );
}

/** Convert a File to a base64 string (without the data: prefix) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:type;base64, prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
