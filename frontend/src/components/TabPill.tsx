import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, Sparkles } from 'lucide-react'
import { haptic } from '../lib/telegram'

// Овал внизу слева, зеркало «плюса»: две вкладки — иконка и подпись под ней.
const TABS = [
  { id: 'projects', label: 'Проекты', icon: LayoutGrid, to: '/' },
  { id: 'generate', label: 'Генерация', icon: Sparkles, to: '/generate' },
]

export default function TabPill() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const active = pathname.startsWith('/generate') ? 'generate' : 'projects'

  return (
    <div
      className="fixed left-4 z-30 flex items-center gap-1 p-1 rounded-full bg-[#2c2c2e] border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,.6)]"
      style={{ bottom: 'calc(22px + env(safe-area-inset-bottom))' }}
    >
      {TABS.map((t) => {
        const on = active === t.id
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              haptic('light')
              nav(t.to)
            }}
            className={`flex flex-col items-center justify-center gap-0.5 w-[74px] h-[52px] rounded-full transition-colors ${
              on ? 'bg-[#2a8bff] text-white' : 'text-white/55 active:bg-white/[.06]'
            }`}
          >
            <Icon size={19} strokeWidth={on ? 2.2 : 1.9} />
            <span className="text-[11px] font-medium leading-none">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
