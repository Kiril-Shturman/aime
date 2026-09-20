import { Flag } from 'lucide-react'
import { ListItem } from 'konsta/react'
import { Chip } from 'konsta/react'
import { MemberChip, StatusChip } from './TaskChips'
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

// «взял 12 минут назад» — видно, что агент не завис
function fmtSince(iso?: string | number | null) {
  if (!iso) return ''
  const value = typeof iso === 'number' && iso < 1_000_000_000_000 ? iso * 1000 : iso
  const minut = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (!Number.isFinite(minut) || minut < 0) return ''
  if (minut < 1) return 'только что'
  if (minut < 60) return `${minut} мин`
  const hodin = Math.floor(minut / 60)
  if (hodin < 24) return `${hodin} ч`
  return `${Math.floor(hodin / 24)} дн`
}

export default function TaskRow({ task, showProject, onEdit }: Props) {
  const { state, refresh } = useApp()
  const m = state ? memberOf(task, state.projects) : null
  const project = state?.projects.find((p) => p.id === task.project)
  const when = [task.due, task.time].filter(Boolean).join(' ')
  const vPraci = task.status === 'doing' ? fmtSince(task.started_at) : ''
  const activity = task.status === 'doing' ? fmtSince(task.progress_updated_at ?? task.started_at) : ''
  // кто проверяет: он может быть и в этом проекте, и общим агентом доски
  const kontroler = task.checker
    ? project?.members.find((x) => x.id === task.checker) ??
      state?.agents?.find((x) => x.id === task.checker)
    : null
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
          {/* чипы: в каком состоянии задача и кто её взял */}
          {task.status !== 'todo' && (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusChip status={task.status} />
              {task.status === 'doing' && vPraci && (
                <Chip className="!m-0 !h-7 !text-[12px] bg-black/[.06] text-black/55 dark:bg-white/10 dark:text-white/50">
                  {vPraci}
                </Chip>
              )}
              {task.status === 'review' && (
                <Chip className="!m-0 !h-7 !text-[12px] bg-black/[.06] text-black/55 dark:bg-white/10 dark:text-white/50">
                  попытка {task.attempts ?? 1}/{task.max_attempts ?? 3}
                </Chip>
              )}
              {task.status === 'review' && kontroler && (
                <MemberChip member={kontroler} prefix="проверяет" />
              )}
              {task.status !== 'review' && <MemberChip member={m} />}
            </span>
          )}
          {task.check?.status === 'fail' && (
            <span className="mt-1 block rounded-lg bg-black/[.04] px-2 py-1.5 text-[13px] text-black/70 dark:bg-white/[.06] dark:text-white/70">
              <span className="font-semibold">Вернули: </span>
              {task.check.why}
              {task.check.shot && (
                <img
                  src={task.check.shot}
                  alt="скрин проверки"
                  className="mt-1.5 max-h-40 w-full rounded-lg object-cover object-top"
                />
              )}
            </span>
          )}
          {task.status === 'doing' && (
            <span className="mt-1 block rounded-lg bg-black/[.04] px-2 py-1.5 text-[13px] text-black/70 dark:bg-white/[.06] dark:text-white/70">
              <span className="font-semibold">Сейчас: </span>
              {task.progress_step || 'запускает задачу'}
              <span className="block text-[12px] text-black/45 dark:text-white/40">
                {[
                  vPraci ? `в работе ${vPraci}` : null,
                  task.tokens ? `${fmtNum(task.tokens)} токенов` : null,
                  activity ? `активность ${activity} назад` : null,
                ].filter(Boolean).join(' · ')}
              </span>
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
          {task.verification_report && (
            <span className="block text-black/70 dark:text-white/70 text-[13px] mt-1 border-l-2 border-[#ff9f0a] pl-2 whitespace-pre-wrap">
              Проверка: {task.verification_report}
            </span>
          )}
          {(task.commit || task.tokens || task.seconds) && (
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
