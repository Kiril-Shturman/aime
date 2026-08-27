import type { PointerEvent } from 'react'
import { useRef } from 'react'
import { haptic } from './telegram'

// Хук долгого нажатия: даёт onPointerDown/Up/Move/Cancel. Через 500ms
// без движения — вызывает fn с координатой пальца. Работает и на тач-,
// и на десктопе (right-click тоже принят).
export function useLongPress(fn: (x: number, y: number) => void, ms = 500) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        haptic('medium')
        fn(e.clientX, e.clientY)
      }, ms)
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return
      const dx = Math.abs(e.clientX - start.current.x)
      const dy = Math.abs(e.clientY - start.current.y)
      if (dx > 8 || dy > 8) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // Правый клик на десктопе тоже вызываем меню, гасим системное
      e.preventDefault()
      fn(e.clientX, e.clientY)
    },
  }
}
