import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  Flag,
  Folder,
  History,
  Inbox,
  Plus,
  Search,
} from 'lucide-react'
import { getUser, haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import type { Counts } from '../api/types'
import { Avatar } from './Avatar'
import ProjectSheet from '../sheets/ProjectSheet'

// Плитки-фильтры iOS-«Напоминаний»: те же ключи, цвета и иконки, что на
// мобильной главной, только компактнее для сайдбара.
const GRID_FILTERS: {
  key: keyof Counts
  label: string
  gradient: string
  Icon: ComponentType<{ size?: number }>
}[] = [
  {
    key: 'today',
    label: 'Сегодня',
    gradient: 'linear-gradient(180deg,#4ea3ff,#2a8bff)',
    Icon: CalendarDays,
  },
  {
    key: 'planned',
    label: 'В планах',
    gradient: 'linear-gradient(180deg,#f4776f,#e8635c)',
    Icon: Calendar,
  },
  {
    key: 'all',
    label: 'Все',
    gradient: 'linear-gradient(180deg,#48484a,#3a3a3c)',
    Icon: Inbox,
  },
  {
    key: 'flagged',
    label: 'С флажком',
    gradient: 'linear-gradient(180deg,#f5b556,#eda344)',
    Icon: Flag,
  },
]

const DONE_FILTER = {
  key: 'done' as const,
  label: 'Завершено',
  gradient: 'linear-gradient(180deg,#a7a9ae,#8e9196)',
  Icon: Check,
}

export default function DesktopSidebar() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { state } = useApp()
  const user = getUser()
  const [q, setQ] = useState('')
  const [newProject, setNewProject] = useState(false)
  const [projectsCollapsed, setProjectsCollapsed] = useState<boolean>(
    () => localStorage.getItem('sidebar-projects-collapsed') === '1',
  )
  useEffect(() => {
    localStorage.setItem(
      'sidebar-projects-collapsed',
      projectsCollapsed ? '1' : '0',
    )
  }, [projectsCollapsed])

  const counts: Counts = state?.counts ?? {
    today: 0,
    planned: 0,
    all: 0,
    flagged: 0,
    done: 0,
  }

  const filterActive = pathname.startsWith('/filter/')
    ? pathname.slice('/filter/'.length)
    : null
  const projectActive = pathname.startsWith('/project/')
    ? pathname.slice('/project/'.length)
    : null
  // Плитки и проекты — часть раздела «Сегодня». Whitelist, а не minus:
  // так любой новый раздел (чат, история и т.п.) по умолчанию их не тянет.
  const inToday =
    pathname === '/' ||
    pathname.startsWith('/filter/') ||
    pathname.startsWith('/project/')

  const projects = state?.projects ?? []
  // Открытых задач в каждом проекте — как счётчик справа у строки списка.
  const openByProject = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of state?.tasks ?? []) {
      if (t.done) continue
      const pid = t.project
      if (!pid) continue
      m.set(pid, (m.get(pid) ?? 0) + 1)
    }
    return m
  }, [state?.tasks])

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Гость'
  const letter =
    (user?.first_name || 'Г').trim().charAt(0).toUpperCase() || '?'

  const go = (to: string) => {
    haptic('light')
    nav(to)
  }

  // Пользователь может тянуть правый край сайдбара мышкой. Ширину
  // помним между сессиями, зажимаем в разумных пределах.
  const MIN = 220
  const MAX = 480
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('sidebar-width'))
    return saved >= MIN && saved <= MAX ? saved : 288
  })
  useEffect(() => {
    localStorage.setItem('sidebar-width', String(width))
    // Экспонируем ширину миру: фикс-хедер и мессаджбар в ChatPage
    // читают её как CSS-переменную, чтобы съезжать вместе с сайдбаром.
    document.documentElement.style.setProperty(
      '--sidebar-width',
      `${width}px`,
    )
    return () => {
      document.documentElement.style.removeProperty('--sidebar-width')
    }
  }, [width])

  const dragging = useRef(false)
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const w = Math.min(MAX, Math.max(MIN, ev.clientX))
      setWidth(w)
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <aside
      style={{ width }}
      className="hidden md:flex flex-col shrink-0 h-full relative
                 bg-black/[.04] dark:bg-white/[.05]
                 border-r border-black/[.06] dark:border-white/[.06]"
    >
      <div className="px-3 pt-4 pb-2">
        <label className="flex items-center gap-2 h-9 px-3 rounded-lg bg-black/[.06] dark:bg-white/[.08]">
          <Search size={14} className="text-black/45 dark:text-white/45" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск"
            className="flex-1 bg-transparent outline-none text-[13px] text-black dark:text-white placeholder-black/40 dark:placeholder-white/40"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-0.5 mt-1">
          <NavRow
            active={pathname === '/'}
            onClick={() => go('/')}
            icon={<TodayIcon className="w-5 h-5" />}
            label="Сегодня"
          />
          <NavRow
            active={pathname.startsWith('/generate')}
            onClick={() => go('/generate')}
            icon={<GenerateIcon className="w-5 h-5" />}
            label="Нейросети"
          />
          <NavRow
            active={pathname.startsWith('/history')}
            onClick={() => go('/history')}
            icon={<History className="w-5 h-5" />}
            label="История"
          />
        </div>

        {inToday && (
          <>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {GRID_FILTERS.map((f) => (
            <FilterTile
              key={f.key}
              label={f.label}
              count={counts[f.key]}
              gradient={f.gradient}
              Icon={f.Icon}
              active={filterActive === f.key}
              onClick={() => go(`/filter/${f.key}`)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(`/filter/${DONE_FILTER.key}`)}
          className={`mt-2 w-full h-[54px] rounded-2xl px-3 flex items-center gap-3 text-black dark:text-white bg-black/[.06] dark:bg-white/[.08] transition active:scale-[.99] ${
            filterActive === DONE_FILTER.key
              ? 'ring-2 ring-[#2a8bff]'
              : ''
          }`}
        >
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0"
            style={{ background: DONE_FILTER.gradient }}
          >
            <DONE_FILTER.Icon size={15} />
          </span>
          <span className="flex-1 text-left text-[14px] font-semibold">
            {DONE_FILTER.label}
          </span>
          <span className="text-[15px] font-semibold tabular-nums opacity-70">
            {counts.done}
          </span>
        </button>

        {/* Заголовок «Мои проекты» с наведением: стрелка сворачивает
            список, плюсик открывает форму нового проекта. */}
        <div className="group mt-4 pr-1 flex items-center h-7">
          <button
            type="button"
            onClick={() => setProjectsCollapsed((v) => !v)}
            className="flex-1 min-w-0 flex items-center gap-1 pl-1 pr-2 h-7 rounded-md text-left text-[12px] text-black/50 dark:text-white/45 hover:text-black dark:hover:text-white hover:bg-black/[.05] dark:hover:bg-white/[.06] transition"
          >
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${
                projectsCollapsed ? '-rotate-90' : ''
              }`}
            />
            <span className="flex-1 truncate">Мои проекты</span>
          </button>
          <button
            type="button"
            onClick={() => setNewProject(true)}
            aria-label="Новый проект"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-6 h-6 rounded-md flex items-center justify-center text-black/60 dark:text-white/55 hover:text-[#2a8bff] hover:bg-black/[.05] dark:hover:bg-white/[.06]"
          >
            <Plus size={14} />
          </button>
        </div>
        <div
          className={`flex flex-col overflow-hidden transition-[max-height] duration-200 ${
            projectsCollapsed ? 'max-h-0' : 'max-h-[9999px]'
          }`}
        >
          {projects.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-black/45 dark:text-white/40">
              Пока нет
            </div>
          )}
          {projects.map((p) => {
            const on = projectActive === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(`/project/${p.id}`)}
                className={`h-9 px-2 rounded-lg flex items-center gap-2 text-left transition ${
                  on
                    ? 'bg-black/[.08] dark:bg-white/[.10]'
                    : 'active:bg-black/[.05] dark:active:bg-white/[.06]'
                }`}
              >
                {/* Аватарка первого участника, если он есть — как на HomePage.
                    Без участников — цветной кружок с папкой. */}
                {p.members.length > 0 ? (
                  <Avatar member={p.members[0]} color={p.color} size={24} />
                ) : (
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0"
                    style={{ background: p.color ?? '#2a8bff' }}
                  >
                    <Folder size={13} />
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate text-[14px] text-black dark:text-white">
                  {p.name}
                </span>
                <span className="text-[13px] tabular-nums text-black/50 dark:text-white/40">
                  {openByProject.get(p.id) ?? 0}
                </span>
              </button>
            )
          })}
        </div>
          </>
        )}
      </div>


      <button
        type="button"
        onClick={() => go('/profile')}
        className={`mx-2 mb-3 mt-1 flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition ${
          pathname.startsWith('/profile')
            ? 'bg-black/[.07] dark:bg-white/[.10]'
            : 'active:bg-black/[.05] dark:active:bg-white/[.06]'
        }`}
      >
        {user?.photo_url ? (
          <img
            src={user.photo_url}
            alt=""
            className="w-9 h-9 rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="w-9 h-9 rounded-full bg-[#2a8bff] text-white text-[14px] font-semibold flex items-center justify-center shrink-0">
            {letter}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-black dark:text-white">
            {fullName}
          </span>
          {user?.username && (
            <span className="block truncate text-[12px] text-black/50 dark:text-white/45">
              @{user.username}
            </span>
          )}
        </span>
      </button>

      <ProjectSheet open={newProject} onClose={() => setNewProject(false)} />

      {/* Хватайка правого края: тянешь мышкой — меняешь ширину. */}
      <div
        onMouseDown={startDrag}
        aria-label="Изменить ширину"
        role="separator"
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize
                   hover:bg-[#2a8bff]/40 active:bg-[#2a8bff]/60 transition-colors"
      />
    </aside>
  )
}

function FilterTile({
  label,
  count,
  gradient,
  Icon,
  active,
  onClick,
}: {
  label: string
  count: number
  gradient: string
  Icon: ComponentType<{ size?: number }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: gradient }}
      className={`relative rounded-2xl h-[76px] px-2.5 pt-2 pb-2 text-white text-left transition active:scale-[.98] ${
        active ? 'ring-2 ring-white/70' : ''
      }`}
    >
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/25">
        <Icon size={15} />
      </span>
      <span className="absolute right-2.5 top-1.5 text-2xl font-bold tabular-nums tracking-tight">
        {count}
      </span>
      <span className="block text-[13px] font-semibold mt-1">{label}</span>
    </button>
  )
}

function NavRow({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 h-10 text-left text-[15px] transition ${
        active
          ? 'bg-black/[.08] dark:bg-white/[.10] text-black dark:text-white font-medium'
          : 'text-black/70 dark:text-white/70 active:bg-black/[.05] dark:active:bg-white/[.06]'
      }`}
    >
      <span className={active ? 'text-[#2a8bff]' : 'text-black/55 dark:text-white/55'}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

const TodayIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 304 379"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M80.8191 90.8185H223.358C229.724 90.8185 234.323 86.0479 234.323 79.8637C234.323 73.8563 229.724 69.0857 223.358 69.0857H80.8191C74.2757 69.0857 69.6778 73.8563 69.6778 79.8637C69.6778 86.0479 74.2757 90.8185 80.8191 90.8185ZM80.8191 142.058H164.468C170.658 142.058 175.432 137.288 175.432 131.104C175.432 125.096 170.658 120.326 164.468 120.326H80.8191C74.2757 120.326 69.6778 125.096 69.6778 131.104C69.6778 137.288 74.2757 142.058 80.8191 142.058ZM83.4719 316.981H214.162C229.724 316.981 237.683 309.031 237.683 293.481V195.242C237.683 179.693 229.724 171.566 214.162 171.566H83.4719C68.4399 171.566 59.7743 179.693 59.7743 195.242V293.481C59.7743 309.031 68.4399 316.981 83.4719 316.981ZM0 323.52C0 360.447 18.2153 378.823 54.8225 378.823H242.634C279.241 378.823 297.457 360.447 297.457 323.52V55.4806C297.457 18.7292 279.241 0 242.634 0H54.8225C18.2153 0 0 18.7292 0 55.4806V323.52ZM28.4725 322.989V56.0106C28.4725 38.3416 37.8452 28.4471 56.2374 28.4471H241.219C259.611 28.4471 268.984 38.3416 268.984 56.0106V322.989C268.984 340.657 259.611 350.375 241.219 350.375H56.2374C37.8452 350.375 28.4725 340.657 28.4725 322.989Z" />
  </svg>
)

const GenerateIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 345 366"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M173.123 344.815C179.788 344.815 185.024 340.052 186.453 332.908C207.402 225.749 221.687 202.412 332.624 186.219C340.239 185.267 345.002 179.551 345.002 172.884C345.002 165.263 340.239 159.548 332.624 158.596C221.687 142.403 202.644 116.685 186.453 12.8591C185.024 4.76263 179.788 0 173.123 0C165.508 0 160.266 4.76263 158.838 12.3828C137.893 118.59 123.608 142.403 13.1496 158.596C5.05143 159.548 0.292969 165.263 0.292969 172.884C0.292969 179.551 5.05143 184.79 13.1496 186.219C123.608 202.412 142.174 225.749 158.838 332.432C159.793 340.052 164.552 344.815 173.123 344.815Z" />
    <path d="M50.6257 361.174C53.2995 361.174 55.0822 359.39 55.4387 356.891C60.7865 323.328 60.7865 320.829 97.1514 315.117C99.6469 314.76 101.43 313.153 101.43 310.475C101.43 307.797 99.6469 306.19 97.1514 305.834C60.7865 300.121 60.7865 297.622 55.4387 264.06C55.0822 261.561 53.2995 259.775 50.6257 259.775C48.13 259.775 46.3474 261.561 45.9909 264.06C40.6431 297.622 40.6431 300.121 4.27822 305.834C1.78259 306.19 0 307.797 0 310.475C0 313.153 1.78259 314.76 4.27822 315.117C40.6431 320.829 40.6431 323.328 45.9909 356.891C46.3474 359.39 48.13 361.174 50.6257 361.174Z" />
    <path d="M297.621 76.3378C299.76 76.3378 301.187 74.731 301.721 72.5904C304.93 52.7744 304.039 51.8805 326.678 47.7747C328.817 47.2391 330.243 45.6322 330.243 43.6689C330.243 41.7056 328.817 39.9196 326.678 39.5631C304.217 35.4573 305.287 34.9217 301.721 14.5702C301.187 12.6069 299.582 11 297.621 11C295.482 11 294.056 12.6069 293.521 14.9285C289.243 34.9217 291.026 35.9929 268.743 39.5631C266.426 39.9196 265 41.5265 265 43.6689C265 45.6322 266.426 47.2391 268.565 47.7747C291.026 51.8805 289.243 52.7744 293.521 72.5904C294.056 74.731 295.482 76.3378 297.621 76.3378Z" />
  </svg>
)
