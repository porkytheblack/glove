import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { memo } from "react";

/* Register only the languages commonly seen in coding-agent output.
   This cuts the bundle from ~1 MB to ~200 KB for syntax highlighting. */
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";

SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("rs", rust);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("diff", diff);

/**
 * Custom theme overrides for syntax highlighting.
 * Keeps the code blocks visually integrated with our dark theme
 * while using Prism's one-dark as a base.
 */
const codeTheme = {
  ...oneDark,
  '::selection': { background: "rgba(88, 166, 255, 0.3)" },
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] ?? {}),
    background: "var(--bg)",
    margin: 0,
    padding: "12px 16px",
    fontSize: "13px",
    lineHeight: "1.5",
    borderRadius: 0,
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] ?? {}),
    background: "var(--bg)",
    fontSize: "13px",
    lineHeight: "1.5",
  },
};

/**
 * Markdown component renders agent text as rich markdown.
 *
 * Design decisions:
 * - Sans-serif font for prose, monospace only for code
 * - GFM support for tables, strikethrough, task lists, autolinks
 * - Fenced code blocks get syntax highlighting with language detection
 * - Inline code gets a subtle background to distinguish from prose
 * - Links open in new tabs to avoid navigating away from the app
 * - Memoized to avoid re-rendering large blocks on every state update
 * - PrismLight with selective language imports to minimize bundle size
 */
function MarkdownInner({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Fenced code blocks with syntax highlighting
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");

            // If this is a fenced code block (has language class or is multiline)
            if (match || codeString.includes("\n")) {
              return (
                <div className="code-block-wrapper">
                  {match && (
                    <div className="code-block-lang">{match[1]}</div>
                  )}
                  <SyntaxHighlighter
                    style={codeTheme as Record<string, React.CSSProperties>}
                    language={match?.[1] ?? "text"}
                    PreTag="div"
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            // Inline code
            const { ref: _ref, ...codeProps } = props;
            return (
              <code className="inline-code" {...codeProps}>
                {children}
              </code>
            );
          },
          // Links open in new tab
          a({ children, href, ref: _ref, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
