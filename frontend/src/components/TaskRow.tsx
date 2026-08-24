import { Flag } from 'lucide-react'
import { ListItem } from 'konsta/react'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import type { Project, Task } from '../api/types'

interface Props {
  task: Task
  showProject?: boolean
  onEdit?: (t: Task) => void
}

function memberOf(task: Task, projects: Project[]) {
  const p = projects.find((x) => x.id === task.project)
  return p?.members.find((m) => m.id === task.member) ?? null
}

function fmtDuration(s: number) {
  if (s < 60) return `${s}с`
  if (s < 3600) return `${Math.round(s / 60)}м`
  return `${(s / 3600).toFixed(1)}ч`
}

function fmtNum(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export default function TaskRow({ task, showProject, onEdit }: Props) {
  const { state, refresh } = useApp()
  const m = state ? memberOf(task, state.projects) : null
  const project = state?.projects.find((p) => p.id === task.project)
  const when = [task.due, task.time].filter(Boolean).join(' ')
  const parts = [
    showProject ? project?.name : null,
    m ? (m.handle || m.name) : null,
    when || null,
  ].filter(Boolean) as string[]

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    haptic('light')
    await api.toggleTask(task.id)
    await refresh()
  }

  return (
    <ListItem
      chevron={false}
      onClick={() => onEdit?.(task)}
      media={
        <button
          type="button"
          onClick={toggle}
          aria-label="Отметить"
          className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 ${
            task.done
              ? 'border-[#2a8bff] bg-[#2a8bff]'
              : 'border-black/25 dark:border-white/25 bg-transparent'
          }`}
        >
          {task.done && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6 9 17l-5-5"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      }
      title={
        <span className={task.done ? 'line-through opacity-60' : ''}>
          {task.title}
        </span>
      }
      subtitle={parts.length > 0 ? parts.join(' · ') : undefined}
      text={
        <>
          {task.status === 'doing' && (
            <span className="inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
              В работе
            </span>
          )}
          {task.note && (
            <span className="block text-black/55 dark:text-white/50 text-[13px] mt-0.5 truncate">
              {task.note}
            </span>
          )}
          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block text-primary text-[13px] mt-0.5 truncate"
            >
              {task.url}
            </a>
          )}
          {task.report && (
            <span className="block text-black/70 dark:text-white/70 text-[13px] mt-1 bg-black/[.04] dark:bg-white/[.04] rounded-lg px-2 py-1.5 whitespace-pre-wrap">
              {task.report}
            </span>
          )}
          {task.done && (task.commit || task.tokens || task.seconds) && (
            <span className="block text-black/55 dark:text-white/50 text-[12px] mt-1">
              {[
                task.commit ? task.commit.slice(0, 7) : null,
                task.tokens ? `${fmtNum(task.tokens)} токенов` : null,
                task.seconds ? fmtDuration(task.seconds) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </>
      }
      after={
        task.flagged ? (
          <Flag size={16} className="text-[#f5b556]" fill="#f5b556" />
        ) : undefined
      }
    />
  )
}
