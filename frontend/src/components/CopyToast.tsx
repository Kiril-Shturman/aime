import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Glass } from 'konsta/react'

interface Detail {
  message: string
}

// Плавающий тост «Скопировано»: слушает глобальное событие copy-toast,
// пишет короткий текст с галочкой. Автоскрывается через 1.6 сек.
export default function CopyToast() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail
      setMsg(d?.message ?? 'Скопировано')
    }
    window.addEventListener('copy-toast', onEvt)
    return () => window.removeEventListener('copy-toast', onEvt)
  }, [])

  useEffect(() => {
    if (msg === null) return
    const t = window.setTimeout(() => setMsg(null), 1600)
    return () => window.clearTimeout(t)
  }, [msg])

  return (
    <div
      className={`pointer-events-none fixed z-[110] left-1/2 -translate-x-1/2
                  bottom-[calc(env(safe-area-inset-bottom)+var(--chat-input-height,0px)+16px)]
                  transition-all duration-200 ease-out ${
                    msg
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 translate-y-3'
                  }`}
    >
      <Glass highlight={false} className="!rounded-full">
        <div className="flex items-center gap-2 px-4 h-10 text-[14px] font-semibold text-black dark:text-white">
          <span className="w-5 h-5 rounded-full bg-[#10B981] flex items-center justify-center">
            <Check size={12} strokeWidth={3.5} className="text-white" />
          </span>
          <span>{msg ?? ''}</span>
        </div>
      </Glass>
    </div>
  )
}

// Хелпер: любой компонент может стрельнуть уведомлением одной строкой.
export function showCopyToast(message = 'Скопировано') {
  window.dispatchEvent(
    new CustomEvent<Detail>('copy-toast', { detail: { message } }),
  )
}
