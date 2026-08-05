/** Inline icons — no dependency, no flash of missing glyph. */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  // A default size as an ATTRIBUTE, not CSS. An inline <svg> with no
  // dimensions expands to fill its flex row, so one missing rule turns a file
  // list into four enormous page glyphs. Attributes lose to any CSS rule, so
  // the per-context sizes in globals.css still win.
  width: 14,
  height: 14,
};

export const GloveMark = () => (
  <svg viewBox="0 0 24 24" className="brand-logo" {...stroke} aria-hidden>
    <path d="M7 21V9a2 2 0 0 1 4 0V4a1.6 1.6 0 0 1 3.2 0v5" />
    <path d="M14.2 9V6.5a1.6 1.6 0 0 1 3.2 0V14a7 7 0 0 1-7 7H7" />
  </svg>
);

export const FolderIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const FileIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const PaperclipIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3" />
  </svg>
);

export const SendIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M4.5 12h14" />
    <path d="m12.5 6 6 6-6 6" />
  </svg>
);

export const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 20h15" />
  </svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const BinaryIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h2v4H9zM13 13h2v4h-2z" />
  </svg>
);
