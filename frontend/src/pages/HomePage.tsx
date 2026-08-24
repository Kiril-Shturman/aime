import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  Calendar,
  Inbox,
  Flag,
  Check,
  Search,
  Plus,
  MoreHorizontal,
  Folder,
  Bot,
  RefreshCw,
  Database,
} from 'lucide-react'
import {
  BlockTitle,
  List,
  ListItem,
  Navbar,
  Page,
  Searchbar,
  Link as KLink,
} from 'konsta/react'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { Avatar } from '../components/Avatar'
import { getUser } from '../lib/telegram'
import Fab from '../components/Fab'
import Menu, { type MenuItem } from '../components/Menu'
import TaskRow from '../components/TaskRow'
import TaskSheet from '../sheets/TaskSheet'
import TaskEditSheet from '../sheets/TaskEditSheet'
import ProjectSheet from '../sheets/ProjectSheet'
import GoalSheet from '../sheets/GoalSheet'
import OutSheet from '../sheets/OutSheet'
import PickerSheet, { type PickerOption } from '../sheets/PickerSheet'
import type { Counts, Task } from '../api/types'

type TileKey = keyof Counts

const TILES: {
  key: TileKey
  route: string
  title: string
  gradient: string
  Icon: typeof CalendarDays
}[] = [
  {
    key: 'today',
    route: 'today',
    title: 'Сегодня',
    gradient: 'linear-gradient(180deg,#4ea3ff,#2a8bff)',
    Icon: CalendarDays,
  },
  {
    key: 'planned',
    route: 'planned',
    title: 'В планах',
    gradient: 'linear-gradient(180deg,#f4776f,#e8635c)',
    Icon: Calendar,
  },
  {
    key: 'all',
    route: 'all',
    title: 'Все',
    gradient: 'linear-gradient(180deg,#48484a,#3a3a3c)',
    Icon: Inbox,
  },
  {
    key: 'flagged',
    route: 'flagged',
    title: 'С флажком',
    gradient: 'linear-gradient(180deg,#f5b556,#eda344)',
    Icon: Flag,
  },
  {
    key: 'done',
    route: 'done',
    title: 'Завершено',
    gradient: 'linear-gradient(180deg,#a7a9ae,#8e9196)',
    Icon: Check,
  },
]

function Tile({
  title,
  count,
  gradient,
  Icon,
  to,
}: {
  title: string
  count: number
  gradient: string
  Icon: typeof CalendarDays
  to: string
}) {
  return (
    <Link
      to={to}
      className="relative rounded-2xl h-[88px] px-3.5 pt-3 pb-3 text-white active:scale-[.98] transition-transform block"
      style={{ background: gradient }}
    >
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
        <Icon size={18} strokeWidth={2.5} />
      </span>
      <span className="absolute right-3.5 top-2 text-3xl font-bold tracking-tight">
        {count}
      </span>
      <span className="block text-[15px] font-semibold mt-2">{title}</span>
    </Link>
  )
}

export default function HomePage() {
  const { state, refresh } = useApp()
  const nav = useNavigate()

  const [q, setQ] = useState('')
  const [searchOn, setSearchOn] = useState(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef<HTMLAnchorElement>(null)

  const [taskOpen, setTaskOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [outOpen, setOutOpen] = useState<{
    title: string
    text: string
  } | null>(null)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [commands, setCommands] = useState<PickerOption[]>([])
  const [editTask, setEditTask] = useState<Task | null>(null)

  const c = state?.counts

  const openTasksProjectCount = useMemo(() => {
    const map = new Map<string, number>()
    state?.tasks.forEach((t) => {
      if (t.done) return
      if (!t.project) return
      map.set(t.project, (map.get(t.project) ?? 0) + 1)
    })
    return map
  }, [state?.tasks])

  const runCommand = async (id: string) => {
    setOutOpen({ title: 'Выполняю…', text: '…' })
    try {
      const out = await api.runCommand(id)
      setOutOpen({ title: out.label, text: out.text })
    } catch (e) {
      setOutOpen({ title: 'Не вышло', text: String(e) })
    }
  }

  const openCommandsMenu = async () => {
    try {
      const { commands } = await api.listCommands()
      setCommands(commands.map((c) => ({ id: c.id, label: c.label })))
      setCommandsOpen(true)
    } catch (e) {
      setOutOpen({ title: 'Не вышло', text: String(e) })
    }
  }

  const menuItems: MenuItem[] = [
    { label: 'Поставить цель', icon: Flag, onSelect: () => setGoalOpen(true) },
    { label: 'Прогнать цикл', icon: RefreshCw, onSelect: () => runCommand('loop') },
    { label: 'Статус агента', icon: Bot, onSelect: () => runCommand('status') },
    { label: 'Ещё команды', icon: MoreHorizontal, onSelect: openCommandsMenu },
    { label: 'Обновить', icon: RefreshCw, onSelect: () => refresh() },
    {
      label: 'Показать выполненные',
      icon: Check,
      onSelect: () => nav('/filter/done'),
    },
    {
      label: 'Данные доски (JSON)',
      icon: Database,
      onSelect: () => window.open('/api/state', '_blank'),
    },
  ]

  const query = q.trim().toLowerCase()
  const searchHits = query
    ? state?.tasks.filter((t) =>
        (t.title + ' ' + (t.note ?? '') + ' ' + (t.report ?? ''))
          .toLowerCase()
          .includes(query),
      ) ?? []
    : []

  return (
    <Page>
      <Navbar
        title="Задачи"
        left={(() => {
          const user = getUser()
          const letter =
            (user?.first_name || 'Г').trim().charAt(0).toUpperCase() || '?'
          return (
            <KLink iconOnly onClick={() => nav('/profile')}>
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#2a8bff] text-white text-[13px] font-semibold flex items-center justify-center">
                  {letter}
                </span>
              )}
            </KLink>
          )
        })()}
        right={
          <>
            <KLink iconOnly onClick={() => setSearchOn(true)}>
              <Search size={22} />
            </KLink>
            <KLink iconOnly onClick={() => setProjectOpen(true)}>
              <Plus size={22} />
            </KLink>
            <KLink
              iconOnly
              ref={menuBtnRef}
              onClick={() => setMenuOpen(true)}
            >
              <MoreHorizontal size={22} />
            </KLink>
          </>
        }
      />

      {/* Поиск-оверлей: разворачивается/сворачивается в правый верхний угол
          (в иконку поиска), перекрывает navbar по высоте */}
      <div
        className={`fixed top-0 left-0 right-0 z-[100] bg-black origin-top-right transition-all duration-300 ease-out ${
          searchOn ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
        }`}
      >
        <div className="pt-[max(16px,env(safe-area-inset-top))] px-4">
          <Searchbar
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onClear={() => setQ('')}
            disableButton
            onDisable={() => {
              setSearchOn(false)
              setQ('')
            }}
            placeholder="Поиск по задачам"
          />
        </div>
      </div>

      {query ? (
        <>
          <BlockTitle>Найдено: {searchHits.length}</BlockTitle>
          {searchHits.length === 0 ? (
            <div className="text-white/50 text-center py-8">Ничего не нашлось</div>
          ) : (
            <List strong inset>
              {searchHits.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showProject
                  onEdit={setEditTask}
                />
              ))}
            </List>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 mt-2">
            {TILES.map((t) => (
              <Tile
                key={t.key}
                title={t.title}
                count={c?.[t.key] ?? 0}
                gradient={t.gradient}
                Icon={t.Icon}
                to={`/filter/${t.route}`}
              />
            ))}
          </div>

          <BlockTitle>Мои проекты</BlockTitle>
          <List strong inset>
            {state?.projects.length === 0 && (
              <ListItem title="Пока нет проектов" />
            )}
            {state?.projects.map((p) => (
              <ListItem
                key={p.id}
                link
                onClick={() => nav(`/project/${p.id}`)}
                title={p.name}
                subtitle={
                  p.members.length > 0
                    ? p.members.map((m) => m.role ?? m.name).join(' · ')
                    : undefined
                }
                after={String(openTasksProjectCount.get(p.id) ?? 0)}
                media={
                  p.members.length > 0 ? (
                    <Avatar member={p.members[0]} color={p.color} />
                  ) : (
                    <span
                      className="flex items-center justify-center w-8 h-8 rounded-full text-white shrink-0"
                      style={{ background: p.color ?? '#2a8bff' }}
                    >
                      <Folder size={16} />
                    </span>
                  )
                }
              />
            ))}
          </List>
        </>
      )}

      <Fab label="Новая задача" onClick={() => setTaskOpen(true)} />

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        target={menuBtnRef}
      />

      <TaskSheet open={taskOpen} onClose={() => setTaskOpen(false)} />
      <ProjectSheet open={projectOpen} onClose={() => setProjectOpen(false)} />
      <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} />
      <TaskEditSheet
        open={editTask != null}
        onClose={() => setEditTask(null)}
        task={editTask}
      />

      <PickerSheet
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        title="Команды"
        options={commands}
        value={null}
        onPick={(id) => id && runCommand(id)}
        allowClear={false}
      />
      <OutSheet
        open={outOpen != null}
        onClose={() => setOutOpen(null)}
        title={outOpen?.title ?? ''}
        text={outOpen?.text ?? ''}
      />
    </Page>
  )
}
