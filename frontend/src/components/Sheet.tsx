import { useEffect, type ReactNode } from 'react'
import { Sheet as KSheet, Link as KLink, Toolbar } from 'konsta/react'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  headerRight?: ReactNode
  headerLeft?: ReactNode
}

// Маленькое окно снизу — ровно как sheet-modal у konsta: тулбар сверху,
// слева название, справа «Готово», под ним контент. Большие карточки
// (задача, модуль) живут не здесь, а в Popup на весь экран.
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
      className="pb-safe w-full max-h-[92dvh] overflow-y-auto"
    >
      {(title || headerRight || headerLeft) && (
        <Toolbar top innerClassName="w-full">
          <div className="flex w-full items-center justify-between gap-3 px-1">
            <span className="truncate text-[17px] font-semibold text-black dark:text-white">
              {headerLeft ?? title}
            </span>
            <span className="shrink-0">
              {headerRight ?? <KLink onClick={onClose}>Готово</KLink>}
            </span>
          </div>
        </Toolbar>
      )}
      {children}
    </KSheet>
  )
}
