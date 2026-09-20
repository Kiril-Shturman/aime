import { useRef, useState } from 'react'
import { Flag, GripVertical } from 'lucide-react'
import { motion, type PanInfo } from 'motion/react'
import { api } from '../api/client'
import type { Project, Task, TaskStatus } from '../api/types'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import { MemberChip, StatusChip } from './TaskChips'

type Bucket = 'todo' | 'doing' | 'done'
type MobileFilter = 'all' | 'doing' | 'done'

const MOBILE_TABS: { id: MobileFilter; label: string }[] = [
  { id: 'all', label: 'Все задачи' },
  { id: 'doing', label: 'В процессе' },
  { id: 'done', label: 'Выполненные' },
]

const COLUMNS: { id: Bucket; label: string; hint: string }[] = [
  { id: 'todo', label: 'К выполнению', hint: 'Ещё не начаты' },
  { id: 'doing', label: 'В процессе', hint: 'Работа, проверка, блокировки' },
  { id: 'done', label: 'Выполненные', hint: 'Готовый результат' },
]

const BUCKET_STATUS: Record<Bucket, TaskStatus> = {
  todo: 'todo',
  doing: 'doing',
  done: 'done',
}

function bucketOf(task: Task): Bucket {
  if (task.status === 'done' || task.done) return 'done'
  if (task.status === 'doing' || task.status === 'review' || task.status === 'blocked') return 'doing'
  return 'todo'
}

function memberOf(task: Task, projects: Project[]) {
  const project = projects.find((item) => item.id === task.project)
  return project?.members.find((member) => member.id === task.member) ?? null
}

function TaskCard({
  task,
  compact = false,
  moving,
  showProject,
  onOpen,
  onMove,
  onSwipe,
}: {
  task: Task
  compact?: boolean
  moving: boolean
  showProject: boolean
  onOpen: () => void
  onMove: (bucket: Bucket) => void
  onSwipe?: (direction: -1 | 1) => void
}) {
  const { state } = useApp()
  const project = state?.projects.find((item) => item.id === task.project)
  const member = state ? memberOf(task, state.projects) : null
  const dragged = useRef(false)
  const current = bucketOf(task)

  const open = () => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    onOpen()
  }

  const card = (
    <article
      onClick={open}
      className={`group relative rounded-[18px] border border-black/[.06] bg-ios-light-surface-1 p-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,.05),0_8px_24px_rgba(0,0,0,.04)] transition-opacity dark:border-white/[.08] dark:bg-ios-dark-surface-1 ${
        moving ? 'pointer-events-none opacity-55' : 'active:scale-[.99]'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <StatusChip status={task.status} />
            {showProject && project && (
              <span className="max-w-40 truncate rounded-full bg-black/[.055] px-2 py-1 text-[11px] font-medium text-black/55 dark:bg-white/[.08] dark:text-white/55">
                {project.name}
              </span>
            )}
          </div>
          <h3 className={`text-[15px] font-semibold leading-snug text-black dark:text-white ${task.done ? 'opacity-55 line-through' : ''}`}>
            {task.title}
          </h3>
          {task.note && !compact && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-black/50 dark:text-white/45">
              {task.note}
            </p>
          )}
        </div>
        <span className="mt-0.5 text-black/20 dark:text-white/20" aria-hidden>
          {task.flagged ? <Flag size={17} fill="currentColor" className="text-[#f5a623]" /> : <GripVertical size={17} />}
        </span>
      </div>

      {task.status === 'doing' && task.progress_step && (
        <div className="mt-2 rounded-xl bg-primary/[.08] px-2.5 py-2 text-[12px] leading-snug text-black/65 dark:text-white/65">
          <span className="font-semibold">Сейчас: </span>{task.progress_step}
        </div>
      )}

      <div className="mt-3 border-t border-black/[.055] pt-2.5 dark:border-white/[.07]">
        <div className="min-h-7 min-w-0">
          {member ? (
            <MemberChip member={member} />
          ) : (
            <span className="text-[11px] text-black/35 dark:text-white/35">Без исполнителя</span>
          )}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-black/40 dark:text-white/40">
            {(task.due || task.time) ? [task.due, task.time].filter(Boolean).join(' · ') : 'Статус задачи'}
          </span>
          <select
            aria-label={`Изменить статус задачи «${task.title}»`}
            value={current}
            disabled={moving}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onMove(event.target.value as Bucket)}
            className="h-8 max-w-[142px] shrink-0 rounded-full border-0 bg-primary/10 px-2.5 text-[11px] font-medium text-primary outline-none disabled:opacity-50"
          >
            <option value="todo">К выполнению</option>
            <option value="doing">В процессе</option>
            <option value="done">Выполнено</option>
          </select>
        </div>
      </div>
    </article>
  )

  if (!onSwipe) return card

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.28}
      onDragStart={() => {
        dragged.current = true
      }}
      onDragEnd={(_event, info: PanInfo) => {
        const distance = info.offset.x
        const velocity = info.velocity.x
        if (Math.abs(distance) > 72 || Math.abs(velocity) > 650) {
          onSwipe(distance < 0 ? 1 : -1)
        }
        window.setTimeout(() => {
          dragged.current = false
        }, 80)
      }}
      whileDrag={{ scale: 1.02, zIndex: 20 }}
      className="touch-pan-y"
    >
      {card}
    </motion.div>
  )
}

export default function TaskBoard({
  tasks,
  onEdit,
  showProject = true,
}: {
  tasks: Task[]
  onEdit: (task: Task) => void
  showProject?: boolean
}) {
  const { refresh } = useApp()
  const [filter, setFilter] = useState<MobileFilter>('all')
  const [moving, setMoving] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState<string | null>(null)
  const counts = {
    all: tasks.length,
    doing: tasks.filter((task) => bucketOf(task) === 'doing').length,
    done: tasks.filter((task) => bucketOf(task) === 'done').length,
  }

  const mobileTasks = (() => {
    if (filter === 'all') return tasks
    return tasks.filter((task) => bucketOf(task) === filter)
  })()

  const move = async (task: Task, bucket: Bucket) => {
    if (bucketOf(task) === bucket || moving.has(task.id)) return
    setMoving((items) => new Set(items).add(task.id))
    haptic('medium')
    try {
      await api.patchTask(task.id, { status: BUCKET_STATUS[bucket] })
      await refresh()
    } finally {
      setMoving((items) => {
        const next = new Set(items)
        next.delete(task.id)
        return next
      })
    }
  }

  const swipe = (task: Task, direction: -1 | 1) => {
    const order: Bucket[] = ['todo', 'doing', 'done']
    const current = order.indexOf(bucketOf(task))
    const next = Math.max(0, Math.min(order.length - 1, current + direction))
    void move(task, order[next])
  }

  return (
    <section className="mt-4">
      <div className="md:hidden">
        <div className="mx-4 grid grid-cols-3 gap-1 rounded-[16px] bg-black/[.055] p-1 dark:bg-white/[.08]">
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                haptic('light')
                setFilter(tab.id)
              }}
              className={`min-w-0 rounded-[12px] px-1 py-2 text-[12px] font-semibold leading-tight transition ${
                filter === tab.id
                  ? 'bg-white text-black shadow-sm dark:bg-white/[.14] dark:text-white'
                  : 'text-black/45 dark:text-white/45'
              }`}
            >
              <span className="block truncate">{tab.label}</span>
              <span className="mt-0.5 block text-[10px] opacity-55">{counts[tab.id]}</span>
            </button>
          ))}
        </div>

        <div className="mx-4 mt-3 space-y-2.5">
          {mobileTasks.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-black/10 px-5 py-10 text-center text-[14px] text-black/40 dark:border-white/10 dark:text-white/40">
              Здесь пока нет задач
            </div>
          ) : (
            mobileTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                moving={moving.has(task.id)}
                showProject={showProject}
                onOpen={() => onEdit(task)}
                onMove={(bucket) => void move(task, bucket)}
                onSwipe={(direction) => swipe(task, direction)}
              />
            ))
          )}
        </div>
        {mobileTasks.length > 0 && (
          <p className="mx-6 mt-2 text-center text-[11px] text-black/30 dark:text-white/30">
            Смахните карточку влево или вправо, чтобы сменить статус
          </p>
        )}
      </div>

      <div className="hidden grid-cols-3 gap-3 px-5 md:grid">
        {COLUMNS.map((column) => {
          const columnTasks = tasks.filter((task) => bucketOf(task) === column.id)
          const activeDrop = dragging !== null
          return (
            <div
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const task = tasks.find((item) => item.id === dragging)
                if (task) void move(task, column.id)
                setDragging(null)
              }}
              className={`min-h-[360px] rounded-[22px] bg-black/[.028] p-3 transition-colors dark:bg-white/[.035] ${activeDrop ? 'ring-1 ring-primary/20' : ''}`}
            >
              <div className="mb-3 flex items-start justify-between px-1">
                <div>
                  <h2 className="text-[15px] font-semibold text-black dark:text-white">{column.label}</h2>
                  <p className="mt-0.5 text-[11px] text-black/35 dark:text-white/35">{column.hint}</p>
                </div>
                <span className="rounded-full bg-black/[.06] px-2 py-0.5 text-[11px] font-semibold text-black/45 dark:bg-white/10 dark:text-white/45">
                  {columnTasks.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => setDragging(null)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <TaskCard
                      task={task}
                      compact
                      moving={moving.has(task.id)}
                      showProject={showProject}
                      onOpen={() => onEdit(task)}
                      onMove={(bucket) => void move(task, bucket)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
