import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { BlockTitle, Segmented, SegmentedButton } from 'konsta/react'
import { haptic } from '../lib/telegram'
import type { Member } from '../api/types'

// Чем участник работает. Всё, что понимает MCP, подключается одинаково —
// меняется только место, куда положить настройку.
import { SPOSOBY, recept } from '../lib/connect'

export default function MemberConnect({ member }: { member: Member }) {
  const [tool, setTool] = useState<string>('promt')
  const [copied, setCopied] = useState(false)

  if (!member.key) return null
  const text = recept(tool, location.origin, member.key, member.name, member.role)

  const copy = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* без буфера — пусть выделяет руками */
    }
  }

  return (
    <>
      <BlockTitle>Чем работает</BlockTitle>
      <div className="px-4 mt-2">
        <Segmented strong rounded>
          {SPOSOBY.map((t) => (
            <SegmentedButton
              key={t.id}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              className="!text-[14px] whitespace-nowrap"
            >
              {t.label}
            </SegmentedButton>
          ))}
        </Segmented>

        <div className="relative mt-3">
          <pre className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-ios-light-surface-1 p-3 pr-11 text-[12px] leading-snug text-black/80 dark:bg-ios-dark-surface-1 dark:text-white/80">
            {text}
          </pre>
          <button
            onClick={copy}
            className="absolute top-2 right-2 p-2 rounded-full bg-black/10 dark:bg-white/10 text-black/70 dark:text-white/70"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>

        <p className="text-black/55 dark:text-white/40 text-[13px] mt-2 leading-snug">
          Ключ личный: по нему доска понимает, кто взял задачу, и не пускает
          посторонних. Отдавать никому не надо.
        </p>
      </div>
    </>
  )
}
