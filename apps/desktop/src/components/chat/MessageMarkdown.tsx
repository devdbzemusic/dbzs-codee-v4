import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageMarkdownProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  onApply?: (proposal: string) => void;
}

export function MessageMarkdown({ className = "", content }: MessageMarkdownProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={`dbzs-markdown prose prose-invert max-w-none text-xs leading-6 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            const rawCode = String(children).replace(/\n$/, "");
            const language = className?.replace("language-", "") ?? "text";
            const isBlock = rawCode.includes("\n") || className?.includes("language-");

            if (!isBlock) {
              return (
                <code className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[11px]" {...rest}>
                  {rawCode}
                </code>
              );
            }

            return (
              <div className="my-2 overflow-hidden rounded border border-dbzs-border bg-[#050b12]">
                <div className="flex items-center justify-between border-b border-dbzs-border bg-dbzs-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-dbzs-muted">
                  <span>{language}</span>
                  <button
                    className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] normal-case tracking-normal text-dbzs-muted hover:text-dbzs-text"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(rawCode);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      } catch {
                        setCopied(false);
                      }
                    }}
                    type="button"
                  >
                    {copied ? "Kopiert" : "Copy"}
                  </button>
                </div>
                <pre className="m-0 overflow-x-auto p-3 text-[11px] leading-6">
                  <code className={className} {...rest}>
                    {rawCode}
                  </code>
                </pre>
              </div>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
