import { Block } from 'konsta/react'
import Sheet from '../components/Sheet'
import type { ContextSource } from '../lib/context-sources'

// «Что это» для карточек: иконка, название и объяснение обычными словами.
export default function AboutSheet({
  source,
  onClose,
}: {
  source: ContextSource | null
  onClose: () => void
}) {
  if (!source) return null
  const { Icon } = source

  return (
    <Sheet open onClose={onClose} title={source.label}>
      <Block className="!mt-0">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-12 h-12 rounded-2xl bg-[#2a8bff]/15 text-[#4ea3ff] flex items-center justify-center shrink-0">
            <Icon size={26} strokeWidth={1.7} />
          </span>
          <div>
            <div className="text-[17px] font-semibold">{source.label}</div>
            <div className="text-[13px] text-white/45">
              {source.ready ? 'уже работает' : 'пока не подключено'}
            </div>
          </div>
        </div>

        {source.what.split('\n\n').map((p, i) => (
          <p key={i} className="text-white/70 text-[15px] leading-snug mt-3">
            {p}
          </p>
        ))}
      </Block>
    </Sheet>
  )
}
