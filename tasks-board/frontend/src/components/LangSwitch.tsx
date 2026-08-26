import { useEffect, useRef, useState } from 'react'
import { Check, Globe } from 'lucide-react'
import { Popover } from 'konsta/react'
import { haptic } from '../lib/telegram'

export type Lang = 'ru' | 'en'

const OPTIONS: { id: Lang; label: string; flag: () => JSX.Element }[] = [
  { id: 'ru', label: 'Русский', flag: () => <RuFlag /> },
  { id: 'en', label: 'English', flag: () => <GbFlag /> },
]

export function useLang() {
  const [lang, set] = useState<Lang>(
    () => (localStorage.getItem('lang') as Lang) || 'ru',
  )
  useEffect(() => {
    localStorage.setItem('lang', lang)
  }, [lang])
  return { lang, setLang: set }
}

interface Props {
  className?: string
}

// Круглая кнопка с планетой + поповер выбора языка. Позиционирование
// оставляем родителю (обычно absolute top-right в углу страницы).
export default function LangSwitch({ className = '' }: Props) {
  const { lang, setLang } = useLang()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={lang === 'ru' ? 'Язык' : 'Language'}
        onClick={() => setOpen(true)}
        className={`h-10 pl-3 pr-4 rounded-full flex items-center gap-2 bg-ios-light-glass dark:bg-ios-dark-glass shadow-ios-light-glass dark:shadow-ios-dark-glass backdrop-blur-lg text-black dark:text-white text-[15px] font-medium active:opacity-70 ${className}`}
      >
        <Globe size={18} />
        <span>{lang === 'ru' ? 'Язык' : 'Language'}</span>
      </button>

      <Popover
        opened={open}
        target={btn.current}
        onBackdropClick={() => setOpen(false)}
        className="!w-56 !mt-3"
      >
        <div className="py-1">
          {OPTIONS.map((o, i) => {
            const active = lang === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  setLang(o.id)
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-black/5 dark:active:bg-white/[.06] ${
                  i > 0
                    ? 'border-t border-black/[.06] dark:border-white/[.06]'
                    : ''
                }`}
              >
                <span className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-white">
                  {o.flag()}
                </span>
                <span className="flex-1 text-[15px]">{o.label}</span>
                {active && (
                  <Check size={16} className="text-[#2a8bff] shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

function RuFlag() {
  return (
    <svg
      viewBox="0 0 3 2"
      className="w-6 h-6"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="3" height="2" fill="#ffffff" />
      <rect y="0.667" width="3" height="0.667" fill="#0039A6" />
      <rect y="1.334" width="3" height="0.666" fill="#D52B1E" />
    </svg>
  )
}

function GbFlag() {
  return (
    <svg
      viewBox="0 0 60 30"
      className="w-6 h-6"
      preserveAspectRatio="xMidYMid slice"
    >
      <clipPath id="gb-clip">
        <rect width="60" height="30" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <g clipPath="url(#gb-clip)">
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
        <path
          d="M0,0 L60,30 M60,0 L0,30"
          stroke="#C8102E"
          strokeWidth="4"
          clipPath="url(#gb-clip)"
        />
        <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  )
}
