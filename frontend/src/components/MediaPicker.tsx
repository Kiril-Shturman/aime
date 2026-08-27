import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Upload, X } from 'lucide-react'
import { Glass } from 'konsta/react'
import { haptic } from '../lib/telegram'

// Одна запись «недавно загруженного» — пока храним только имя, размер и,
// для картинок, base64-превью в localStorage. Реальные файлы попадут в
// media-service (ai-webapi) на следующем шаге.
export interface RecentMedia {
  id: string
  name: string
  size: number
  thumb?: string
  mime?: string
}

const KEY = 'chat-recent-media'

function loadRecent(): RecentMedia[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
function saveRecent(list: RecentMedia[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)))
  } catch {
    /* over quota */
  }
}

async function makeThumb(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 128
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = img.width * scale
        const h = img.height * scale
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        } catch {
          resolve(undefined)
        }
      }
      img.onerror = () => resolve(undefined)
      img.src = fr.result as string
    }
    fr.onerror = () => resolve(undefined)
    fr.readAsDataURL(file)
  })
}

interface Props {
  open: boolean
  onClose: () => void
  onPick: (files: File[]) => void
  onPickRecent: (items: RecentMedia[]) => void
  accept?: string
  // Через сколько пикселей от нижнего края поднять панель — сюда
  // ChatPage прокидывает актуальную высоту мессаджбара.
  anchorBottom?: number
  // Уже выбранные в текущем сообщении — по ним рисуем синюю галочку
  // и блокируем повторный клик.
  selectedIds?: string[]
}

// Пикер медиа: панель зафиксирована над полем ввода, шириной с него
// (использует ту же CSS-переменную --sidebar-width), сверху фон
// затемняется. Не связана с таргетом-скрепкой, поэтому не свисает
// с левого края и не зависит от ширины кнопки.
export default function MediaPicker({
  open,
  onClose,
  onPick,
  onPickRecent,
  accept,
  anchorBottom = 160,
  selectedIds = [],
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const [recent, setRecent] = useState<RecentMedia[]>([])
  // Держим панель смонтированной для fade-out анимации при закрытии.
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      haptic('light')
      setRecent(loadRecent())
      // На следующий кадр — включаем visible для fade-in
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else {
      setVisible(false)
      // Оставляем в DOM ~250ms — CSS-transition успевает отработать
      const t = window.setTimeout(() => setMounted(false), 250)
      return () => window.clearTimeout(t)
    }
  }, [open])

  if (!mounted) return null

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const selectedSet = new Set(selectedIds)

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Панель прибита к тем же left/right, что и мессаджбар, и уезжает
          вверх вместе с ним (anchorBottom = высота мессаджбара + gap).
          fade+slide-in — через transform+opacity, длительность 250ms. */}
      <div
        style={{ bottom: `calc(env(safe-area-inset-bottom) + ${anchorBottom}px)` }}
        className={`fixed z-50 left-4 right-4
                   md:left-[calc(var(--sidebar-width,18rem)+max(0px,(100vw-var(--sidebar-width,18rem)-1000px)/2))]
                   md:right-[max(0px,calc((100vw-var(--sidebar-width,18rem)-1000px)/2))]
                   transition-all duration-250 ease-out ${
                     visible
                       ? 'opacity-100 translate-y-0'
                       : 'opacity-0 translate-y-3'
                   }`}
      >
        <Glass highlight={false} className="!rounded-3xl overflow-hidden">
          {/* Шапка: «Медиа» слева, крестик справа */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[15px] font-semibold text-black dark:text-white">
              Медиа
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-black/[.06] dark:bg-white/[.10] text-black dark:text-white active:opacity-70"
            >
              <X size={14} />
            </button>
          </div>

          {/* Сетка: 2 строки, если элементов много; иначе одна.
              Автоколонки 60px, скролл вбок при переполнении. */}
          <div
            className={`px-3 pt-2 pb-3 grid grid-flow-col auto-cols-[60px] gap-2
                        overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                          1 + (isMobile ? 1 : 0) + recent.length > 6
                            ? 'grid-rows-2'
                            : 'grid-rows-1'
                        }`}
          >
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-[60px] h-[60px] rounded-xl bg-black/[.05] dark:bg-white/[.10]
                         flex flex-col items-center justify-center gap-0.5
                         text-black/70 dark:text-white/70 active:opacity-70"
            >
              <Upload size={16} />
              <span className="text-[9px] font-semibold">Загрузить</span>
            </button>

            {isMobile && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="w-[60px] h-[60px] rounded-xl bg-black/[.05] dark:bg-white/[.10]
                           flex flex-col items-center justify-center gap-0.5
                           text-black/70 dark:text-white/70 active:opacity-70"
              >
                <Camera size={16} />
                <span className="text-[9px] font-semibold">Фото</span>
              </button>
            )}

            {recent.map((r) => {
              const isSelected = selectedSet.has(r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={isSelected}
                  onClick={() => {
                    if (isSelected) return
                    onPickRecent([r])
                  }}
                  className={`relative w-[60px] h-[60px] rounded-xl overflow-hidden bg-black/[.06] dark:bg-white/[.10] flex items-center justify-center transition ${
                    isSelected ? 'ring-2 ring-[#2a8bff]' : 'active:opacity-80'
                  }`}
                >
                  {r.thumb ? (
                    <img
                      src={r.thumb}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[8px] px-1 text-black/60 dark:text-white/55 text-center break-all leading-tight">
                      {r.name}
                    </span>
                  )}
                  {isSelected && (
                    <span className="absolute inset-0 bg-black/25 flex items-center justify-center">
                      <span className="w-6 h-6 rounded-full bg-[#2a8bff] flex items-center justify-center">
                        <Check size={14} strokeWidth={3.5} className="text-white" />
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {recent.length === 0 && (
            <div className="px-4 pb-3 text-[11px] text-black/50 dark:text-white/40 text-center">
              Недавние файлы появятся здесь после первой загрузки
            </div>
          )}
        </Glass>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const list = e.target.files
          if (!list) return
          const files = Array.from(list)
          onPick(files)
          const thumbs = await Promise.all(files.map(makeThumb))
          const additions: RecentMedia[] = files.map((f, i) => ({
            id: `${Date.now()}-${i}-${f.name}`,
            name: f.name,
            size: f.size,
            mime: f.type,
            thumb: thumbs[i],
          }))
          const next = [...additions, ...loadRecent()].slice(0, 30)
          saveRecent(next)
          setRecent(next)
          e.target.value = ''
          onClose()
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          if (list?.[0]) onPick([list[0]])
          e.target.value = ''
          onClose()
        }}
      />
    </>
  )
}
