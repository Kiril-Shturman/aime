import { Chip } from 'konsta/react'
import { Avatar } from './Avatar'
import { TASK_STATUS_LABEL } from '../lib/constants'
import type { Member, Task } from '../api/types'

// Чипы задачи — как в китчен-синке framework7: статус и, если задачу
// кто-то взял, чип с аватаркой исполнителя. Один вид на всю доску.
const TONY: Record<string, string> = {
  todo: 'bg-black/[.06] text-black/60 dark:bg-white/10 dark:text-white/55',
  doing: 'bg-[#2a8bff]/15 text-[#1477e6] dark:text-[#6cb6ff]',
  review: 'bg-[#ff9f0a]/15 text-[#a85f00] dark:text-[#ffb84d]',
  blocked: 'bg-[#ff375f]/15 text-[#c72546] dark:text-[#ff6b87]',
  done: 'bg-[#30d158]/15 text-[#168c3a] dark:text-[#4ee27a]',
}

export function StatusChip({ status }: { status: string }) {
  return (
    <Chip className={`!m-0 !h-7 !text-[12px] !font-semibold ${TONY[status] ?? TONY.todo}`}>
      {TASK_STATUS_LABEL[status] ?? status}
    </Chip>
  )
}

// «Взял» — кто держит задачу. Без исполнителя показываем, что она ничья.
export function MemberChip({
  member,
  prefix = 'взял',
}: {
  member?: Member | null
  prefix?: string
}) {
  if (!member) {
    return (
      <Chip className="!m-0 !h-7 !text-[12px] bg-black/[.06] text-black/45 dark:bg-white/10 dark:text-white/40">
        никто не взял
      </Chip>
    )
  }
  return (
    <Chip
      className="!m-0 !h-7 !text-[12px] bg-black/[.06] text-black/70 dark:bg-white/10 dark:text-white/70"
      media={<Avatar member={member} size={22} />}
    >
      {prefix}: {member.name}
    </Chip>
  )
}

// Берёт ли агент новые задачи сам. Владелец переключает это в карточке.
export function AutoChip({ on }: { on: boolean }) {
  return (
    <Chip
      className={`!m-0 !h-7 !text-[12px] !font-semibold ${
        on
          ? 'bg-[#30d158]/15 text-[#168c3a] dark:text-[#4ee27a]'
          : 'bg-black/[.06] text-black/50 dark:bg-white/10 dark:text-white/45'
      }`}
    >
      {on ? 'берёт задачи' : 'новых не берёт'}
    </Chip>
  )
}

export function TaskChips({
  task,
  member,
}: {
  task: Task
  member?: Member | null
}) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <StatusChip status={task.status} />
      <MemberChip member={member} />
      {task.commit && (
        <Chip className="!m-0 !h-7 !text-[12px] bg-black/[.06] font-mono text-black/55 dark:bg-white/10 dark:text-white/50">
          {task.commit.slice(0, 7)}
        </Chip>
      )}
    </span>
  )
}
