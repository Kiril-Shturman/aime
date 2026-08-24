import { useRef, useState } from 'react'
import { ChevronUp, Folder, LayoutGrid } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Menu, { type MenuItem } from './Menu'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

// Овал слева, зеркало «плюса»: показывает, где ты сейчас, и по нажатию
// даёт перепрыгнуть в другой проект, не возвращаясь на главную.
export default function SwitchPill({ current }: { current?: string | null }) {
  const nav = useNavigate()
  const { state } = useApp()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const project = state?.projects.find((p) => p.id === current) ?? null
  const open_ = new Map<string, number>()
  for (const t of state?.tasks ?? []) {
    if (!t.done && t.project) open_.set(t.project, (open_.get(t.project) ?? 0) + 1)
  }
  const label = project ? project.name : 'Все проекты'

  const items: MenuItem[] = [
    {
      label: 'Все проекты',
      icon: LayoutGrid,
      onSelect: () => nav('/'),
    },
    ...(state?.projects ?? [])
      .filter((p) => p.id !== current)
      .map((p) => ({
        label: p.name,
        sub: open_.get(p.id) ? `${open_.get(p.id)} открытых` : 'пусто',
        icon: Folder,
        onSelect: () => nav(`/project/${p.id}`),
      })),
  ]

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          haptic('light')
          setOpen(true)
        }}
        className="fixed left-4 z-30 flex items-center gap-2 h-14 max-w-[58%] pl-5 pr-4 rounded-full bg-[#2c2c2e] border border-white/10 text-white text-[15px] font-medium shadow-[0_6px_20px_rgba(0,0,0,.6)] active:opacity-80"
        style={{ bottom: 'calc(22px + env(safe-area-inset-bottom))' }}
      >
        <span className="truncate">{label}</span>
        <ChevronUp size={17} className="opacity-45 shrink-0" />
      </button>

      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        target={ref}
      />
    </>
  )
}
