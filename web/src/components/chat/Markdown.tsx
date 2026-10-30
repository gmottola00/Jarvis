import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

/** The plain text inside a rendered node - what the copy button puts on the clipboard. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-5 mb-2 flex items-center gap-2 font-display text-lg font-bold tracking-[0.15em] text-white uppercase first:mt-0">
      <span className="h-4 w-1 bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" aria-hidden />
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 flex items-center gap-2 border-b border-ultron-900 pb-1 font-display text-base font-bold tracking-[0.15em] text-ultron-300 uppercase first:mt-0">
      <span className="h-3.5 w-1 bg-ultron-500" aria-hidden />
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-1.5 font-display text-sm font-semibold tracking-[0.12em] text-ink-200 uppercase first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="text-ink-300">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-ultron-300 underline decoration-ultron-700 underline-offset-2 hover:text-ultron-400">
      {children}
    </a>
  ),
  // Unordered items get a red diamond; ordered ones keep their numbers.
  ul: ({ children }) => (
    <ul className="my-2 space-y-1 pl-4 [&>li]:relative [&>li]:before:absolute [&>li]:before:top-[0.6em] [&>li]:before:-left-3.5 [&>li]:before:size-1.5 [&>li]:before:rotate-45 [&>li]:before:bg-ultron-500/80 [&>li]:before:content-['']">
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:font-mono marker:text-xs marker:text-ultron-400">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-ultron-600 bg-ultron-500/5 px-3 py-1.5 text-ink-300">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-0 border-t border-dashed border-ink-800" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-ink-800">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-ultron-500/10">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-ultron-900 px-3 py-1.5 text-left font-display font-semibold tracking-wider text-ultron-300 uppercase">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-ink-850 px-3 py-1.5 align-top font-mono text-[11px] text-ink-300">{children}</td>,
  pre: ({ children }) => {
    const code = Children.toArray(children)[0];
    const className = isValidElement<{ className?: string }>(code) ? (code.props.className ?? "") : "";
    const language = /language-(\S+)/.exec(className)?.[1] ?? "text";
    return (
      <div className="my-3 overflow-hidden rounded-md border border-ink-800 bg-ink-950">
        <div className="flex items-center justify-between border-b border-ink-850 bg-ink-900 px-3 py-1">
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-ink-600 uppercase">
            <span className="size-1.5 rounded-full bg-ultron-500" aria-hidden />
            {language}
          </span>
          <CopyButton text={textOf(children).replace(/\n$/, "")} />
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-ink-300">{children}</pre>
      </div>
    );
  },
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded border border-ink-800 bg-ink-950 px-1 py-px font-mono text-[0.85em] text-ultron-300">{children}</code>
    ),
};

/** Assistant text, rendered: GitHub-flavoured markdown with highlighted code. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-ink-200 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
