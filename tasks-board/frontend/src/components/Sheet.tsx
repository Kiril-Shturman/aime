import { useEffect, useRef, type ReactNode } from 'react'
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
  const boxRef = useRef<HTMLDivElement>(null)
  const grabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  useEffect(() => {
    const handle = grabRef.current
    const box = boxRef.current
    if (!handle || !box) return
    let startY = 0
    let delta = 0
    let dragging = false
    const down = (e: PointerEvent) => {
      dragging = true
      startY = e.clientY
      delta = 0
      handle.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      delta = Math.max(0, e.clientY - startY)
      box.style.transform = `translateY(${delta}px)`
    }
    const end = () => {
      if (!dragging) return
      dragging = false
      if (delta > 90) {
        onClose()
        haptic('light')
      }
      box.style.transform = ''
    }
    handle.addEventListener('pointerdown', down)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
    return () => {
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
  }, [onClose])

  return (
    <KSheet
      opened={open}
      onBackdropClick={onClose}
      className="max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] !bg-black"
    >
      <div ref={boxRef}>
        <button
          ref={grabRef}
          aria-label="Потяните, чтобы закрыть"
          className="block mx-auto mt-2 mb-1 w-10 h-1.5 rounded-full bg-white/25 touch-none"
        />
        {(title || headerRight || headerLeft) && (
          <div className="flex items-center gap-3 px-4 pt-2 pb-3">
            {headerLeft ?? (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white active:bg-white/20"
              >
                <X size={16} />
              </button>
            )}
            <div className="flex-1 text-center text-white text-[17px] font-semibold">
              {title}
            </div>
            {headerRight ?? <div className="w-8 h-8" />}
          </div>
        )}
        <div className="px-4 pb-6">{children}</div>
      </div>
    </KSheet>
  )
}
