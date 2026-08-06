/**
 * Shapes the browser and the routes both need.
 *
 * Kept away from `desk.ts` on purpose: that module pulls in the working
 * environment and the format adapters, and a client component importing it —
 * even for a type — is one careless `import` away from dragging sharp into
 * the browser bundle.
 */

/** One entry in the flat tree listing returned by `GET /api/fs`. */
export interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  size: number;
  ext: string;
}

/** One file's content, returned by `GET /api/fs?path=…`. */
export interface FilePreview {
  path: string;
  size: number;
  /** True for anything the preview pane will not try to render as text. */
  binary?: boolean;
  /** From the extension — tells the pane whether it can show this itself. */
  mediaType?: string;
  text?: string;
}
