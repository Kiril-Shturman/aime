import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import 'highlight.js/styles/github-dark.css'
import { showCopyToast } from './CopyToast'

// Рендерит текст ответа ИИ как markdown: заголовки, списки, таблицы,
// цитаты, ссылки, инлайн-код и полноценные блоки кода с подсветкой.
// GFM даёт таблицы и task lists, rehype-highlight — раскраску hljs.
export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose-chat min-w-0 [overflow-wrap:anywhere] [&_p]:[overflow-wrap:anywhere] [&_li]:[overflow-wrap:anywhere] [&_code]:[overflow-wrap:anywhere] [&_a]:[overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2a8bff] hover:underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            // Таблицы оборачиваем в горизонтально-скроллящийся контейнер,
            // чтобы широкие не ломали ленту сообщений.
            <div className="my-3 overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.10]">
              <table className="w-full text-[14px] border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-black/[.04] dark:bg-white/[.06]">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold px-3 py-2 border-b border-black/[.08] dark:border-white/[.10]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-black/[.06] dark:border-white/[.08] align-top">
              {children}
            </td>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>
          ),
          h1: ({ children }) => (
            <h1 className="text-[1.8em] font-bold leading-tight mt-6 mb-4 pb-3 border-b border-black/[.08] dark:border-white/[.08]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[1.5em] font-bold leading-tight mt-5 mb-3 pb-2 border-b border-black/[.06] dark:border-white/[.06]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[1.3em] font-bold leading-tight mt-4 mb-2">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[1.1em] font-bold leading-tight mt-3 mb-1.5">
              {children}
            </h4>
          ),
          hr: () => (
            <hr className="my-5 border-0 h-px bg-gradient-to-r from-transparent via-black/15 to-transparent dark:via-white/15" />
          ),
          strong: ({ children }) => (
            <strong className="font-bold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-[#2a8bff] pl-3 my-3 py-2 pr-2 rounded-r-md bg-[#2a8bff]/[.08] text-black/85 dark:text-white/80 italic">
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...rest }) => {
            // Inline-код и блочный различаем по наличию language-класса:
            // rehype-highlight ставит `hljs language-*` только для блоков.
            const isInline = !className?.includes('language-')
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded-md bg-black/[.06] dark:bg-white/[.10] text-[.9em] font-mono">
                  {children}
                </code>
              )
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          p: ({ children }) => (
            <p className="my-2 leading-[1.6]">{children}</p>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// Обёртка над <pre>: сверху — плашка с языком и кнопкой копирования,
// снизу — сам <pre> с раскраской hljs. Язык извлекаем из className.
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  // children — это <code>, у которого мы читаем className и текст.
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string; children?: ReactNode } }
    | undefined
  const cls = codeEl?.props?.className ?? ''
  const lang =
    cls.match(/language-([\w+-]+)/)?.[1]?.toLowerCase() ?? 'code'
  const raw = extractText(codeEl?.props?.children)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      showCopyToast('Код скопирован')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard недоступен — молча */
    }
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-black/[.08] dark:border-white/[.10] bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/[.20] dark:bg-white/[.05] text-[12px] text-white/70">
        <span className="uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 hover:text-white transition"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-[13px] leading-relaxed text-white">
        {children}
      </pre>
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}
