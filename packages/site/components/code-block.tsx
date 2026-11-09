import { codeToHtml } from "shiki";
import { CopyButton } from "./copy-button";

interface CodeBlockProps {
  code: string;
  filename?: string;
  language?: string;
}

export async function CodeBlock({
  code,
  filename,
  language = "typescript",
}: CodeBlockProps) {
  const html = await codeToHtml(code.trim(), {
    lang: language,
    // Both palettes ship as CSS variables (--shiki-dark / --shiki-light);
    // globals.css picks one from <html data-theme>.
    themes: { dark: "vitesse-dark", light: "vitesse-light" },
    defaultColor: false,
  });

  return (
    <div className="code-block">
      {(filename || language) && (
        <div className="code-block-header">
          <span>{filename}</span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            {language && <span>{language}</span>}
            <CopyButton text={code.trim()} />
          </span>
        </div>
      )}
      <div className="code-block-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
