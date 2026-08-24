import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Sheet as KSheet } from 'konsta/react'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  headerRight?: ReactNode
  headerLeft?: ReactNode
}

export default function Sheet({
  open,
  onClose,
  title,
  children,
  headerRight,
  headerLeft,
}: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <KSheet
      opened={open}
      onBackdropClick={onClose}
      className="pb-safe max-h-[92dvh] overflow-y-auto"
    >
      {(title || headerRight || headerLeft) && (
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          {headerLeft ?? (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center text-black dark:text-white active:opacity-70"
            >
              <X size={16} />
            </button>
          )}
          <div className="flex-1 text-center text-[17px] font-semibold">
            {title}
          </div>
          {headerRight ?? <div className="w-8 h-8" />}
        </div>
      )}
      {children}
    </KSheet>
  )
}
