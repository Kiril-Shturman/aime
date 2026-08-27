import { useEffect } from 'react'
import { Copy, Trash2, type LucideIcon } from 'lucide-react'
import { Glass } from 'konsta/react'

export interface MenuAction {
  label: string
  icon: LucideIcon
  destructive?: boolean
  onSelect: () => void
}

interface Props {
  x: number
  y: number
  actions: MenuAction[]
  onClose: () => void
}

// iOS-стиль контекстного меню: тёмная подложка с blur, панель с
// действиями рядом с точкой нажатия. Появляется на долгом тапе.
export default function MessageMenu({ x, y, actions, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ограничиваем координаты, чтобы меню не улетело за край экрана.
  // На длинных сообщениях, если снизу места нет — открываем над пальцем.
  const W = 220
  const H = 24 + actions.length * 44 // ~44px на пункт + паддинги
  const M = 16
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(Math.max(x - W / 2, M), vw - W - M)
  const belowY = y + 24
  const fitsBelow = belowY + H + M <= vh
  const top = fitsBelow ? belowY : Math.max(M, y - H - 24)

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[90] bg-black/40"
      />
      <div
        style={{ left, top, width: W }}
        className="fixed z-[100]"
      >
        <Glass highlight={false} className="!rounded-3xl overflow-hidden">
          <div className="py-1">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onClose()
                  a.onSelect()
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/[.06] ${
                  a.destructive
                    ? 'text-[#ff3b30]'
                    : 'text-black dark:text-white'
                } ${
                  i > 0
                    ? 'border-t border-black/[.06] dark:border-white/[.06]'
                    : ''
                }`}
              >
                <a.icon size={16} className="opacity-80 shrink-0" />
                <span className="flex-1 text-[15px] font-medium">
                  {a.label}
                </span>
              </button>
            ))}
          </div>
        </Glass>
      </div>
    </>
  )
}

// Пресеты — экспортируем, чтобы ChatPage не тащил иконки сам.
export { Copy, Trash2 }
