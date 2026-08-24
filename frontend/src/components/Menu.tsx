import { useEffect, type ComponentType, type RefObject } from 'react'
import { Popover } from 'konsta/react'
import { haptic } from '../lib/telegram'

export interface MenuItem {
  label: string
  sub?: string
  icon?: ComponentType<{ size?: number }>
  red?: boolean
  onSelect: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  items: MenuItem[]
  target: RefObject<HTMLElement | null>
}

export default function Menu({ open, onClose, items, target }: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <Popover
      opened={open}
      target={target.current}
      onBackdropClick={onClose}
      className="!w-64"
    >
      <div className="py-1">
        {items.map((it, i) => {
          const Icon = it.icon
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                onClose()
                it.onSelect()
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-black/5 dark:active:bg-white/[.06] ${
                it.red ? 'text-red-500' : ''
              } ${i > 0 ? 'border-t border-black/[.06] dark:border-white/[.06]' : ''}`}
            >
              <span className="w-6 h-6 flex items-center justify-center opacity-80">
                {Icon ? <Icon size={18} /> : null}
              </span>
              <span className="flex-1">
                <span className="block text-[15px]">{it.label}</span>
                {it.sub && (
                  <span className="block text-[12px] opacity-60 mt-0.5">
                    {it.sub}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
