import { CheckSquare } from "@phosphor-icons/react/CheckSquare";
import { Square } from "@phosphor-icons/react/Square";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownDocument({ body }: { body: string }) {
  return <div className="codkesh-document mx-auto max-w-[72ch] pb-10 pt-2">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        h1: ({ children }) => <h1 className="mb-7 mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight sm:text-2xl">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-7 text-base font-semibold sm:text-lg">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</h4>,
        p: ({ children }) => <p className="my-4 text-[15px] leading-7 text-foreground/82 sm:text-base sm:leading-8">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="text-foreground/90">{children}</em>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline decoration-primary/35 underline-offset-4 transition hover:decoration-primary">{children}</a>,
        ul: ({ children, className }) => <ul className={`my-4 space-y-2 pl-1 ${className ?? ""}`}>{children}</ul>,
        ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6 marker:text-muted-foreground">{children}</ol>,
        li: ({ children, className }) => <li className={`text-[15px] leading-7 text-foreground/82 sm:text-base ${className?.includes("task-list-item") ? "flex list-none items-start gap-2" : "ml-5 list-disc pl-1 marker:text-primary"}`}>{children}</li>,
        input: ({ checked, type }) => type === "checkbox" ? <span className="mt-1.5 shrink-0 text-primary">{checked ? <CheckSquare weight="fill" /> : <Square />}</span> : null,
        blockquote: ({ children }) => <blockquote className="my-6 rounded-r-2xl bg-primary/[.07] px-5 py-2 text-foreground/80 shadow-[inset_3px_0_0_hsl(var(--primary))]">{children}</blockquote>,
        hr: () => <div className="my-12" role="separator" aria-label="Section break" />,
        table: ({ children }) => <div className="my-6 overflow-x-auto rounded-2xl bg-muted/40 p-1"><table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left text-sm">{children}</table></div>,
        thead: ({ children }) => <thead className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{children}</thead>,
        th: ({ children }) => <th className="bg-muted/70 px-4 py-3 first:rounded-l-xl last:rounded-r-xl">{children}</th>,
        td: ({ children }) => <td className="px-4 py-3 align-top text-foreground/80">{children}</td>,
        pre: ({ children }) => <pre className="my-6 overflow-x-auto rounded-2xl bg-[#11100e] p-5 text-[13px] leading-6 text-[#f5f2eb] shadow-inner">{children}</pre>,
        code: ({ children, className }) => className ? <code className={className}>{children}</code> : <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-foreground">{children}</code>,
      }}
    >{body}</ReactMarkdown>
  </div>;
}
