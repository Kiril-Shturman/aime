import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export interface PhotoItem {
  kind: 'image' | 'video'
  url: string
  name?: string
}

interface Props {
  items: PhotoItem[]
  index: number | null
  onClose: () => void
}

// Простой фотобраузер по мотивам f7 PhotoBrowser: черный фон,
// текущее фото/видео по центру, стрелки/клавиши влево-вправо для навигации,
// счётчик и крестик сверху, свайп-закрытие.
export default function PhotoBrowser({ items, index, onClose }: Props) {
  const [current, setCurrent] = useState<number>(index ?? 0)

  useEffect(() => {
    if (index !== null) setCurrent(index)
  }, [index])

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')
        setCurrent((i) => (i - 1 + items.length) % items.length)
      if (e.key === 'ArrowRight')
        setCurrent((i) => (i + 1) % items.length)
    }
    document.addEventListener('keydown', onKey)
    // Блокируем скролл body пока открыт
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [index, items.length, onClose])

  if (index === null || items.length === 0) return null

  const item = items[current] ?? items[0]

  const prev = () =>
    setCurrent((i) => (i - 1 + items.length) % items.length)
  const next = () => setCurrent((i) => (i + 1) % items.length)

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
      {/* Клик по фону — закрыть */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Контент */}
      <div className="relative max-w-full max-h-full flex items-center justify-center px-4">
        {item.kind === 'image' ? (
          <img
            src={item.url}
            alt={item.name ?? ''}
            className="max-w-[calc(100vw-32px)] max-h-[calc(100vh-100px)] object-contain"
          />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            className="max-w-[calc(100vw-32px)] max-h-[calc(100vh-100px)]"
          />
        )}
      </div>

      {/* Стрелки — только если больше одного */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Предыдущее"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-ios-dark-glass shadow-ios-dark-glass backdrop-blur-lg k-glass text-white flex items-center justify-center active:opacity-70 transition"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Следующее"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-ios-dark-glass shadow-ios-dark-glass backdrop-blur-lg k-glass text-white flex items-center justify-center active:opacity-70 transition"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Топбар: счётчик по центру, крестик справа */}
      <div className="absolute top-0 inset-x-0 pt-[max(12px,env(safe-area-inset-top))] px-4 flex items-center justify-between">
        <div className="text-white/80 text-[14px] font-medium">
          {items.length > 1 ? `${current + 1} / ${items.length}` : ''}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="w-10 h-10 rounded-full bg-ios-dark-glass shadow-ios-dark-glass backdrop-blur-lg k-glass text-white flex items-center justify-center active:opacity-70 transition"
        >
          <X size={20} />
        </button>
      </div>

      {/* Подпись */}
      {item.name && (
        <div className="absolute bottom-0 inset-x-0 pb-[max(12px,env(safe-area-inset-bottom))] px-6 text-center">
          <div className="inline-block max-w-full truncate text-white/80 text-[13px] bg-black/40 px-3 py-1 rounded-full backdrop-blur">
            {item.name}
          </div>
        </div>
      )}
    </div>
  )
}
