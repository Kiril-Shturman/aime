import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { List, ListItem, Navbar, NavbarBackLink, Page } from 'konsta/react'
import { useApp } from '../store/AppStore'
import TaskRow from '../components/TaskRow'
import TaskEditSheet from '../sheets/TaskEditSheet'
import type { Task } from '../api/types'

const TITLES: Record<string, string> = {
  today: 'Сегодня',
  planned: 'В планах',
  all: 'Все',
  flagged: 'С флажком',
  done: 'Завершено',
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function filter(kind: string, tasks: Task[]): Task[] {
  const open = tasks.filter((t) => !t.done)
  if (kind === 'today') return open.filter((t) => t.due && t.due <= todayStr())
  if (kind === 'planned') return open.filter((t) => !!t.due)
  if (kind === 'all') return open
  if (kind === 'flagged') return open.filter((t) => t.flagged)
  if (kind === 'done') return tasks.filter((t) => t.done)
  return []
}

export default function FilterPage() {
  const { kind = 'all' } = useParams()
  const navigate = useNavigate()
  const { state } = useApp()
  const [editTask, setEditTask] = useState<Task | null>(null)

  const tasks = useMemo(
    () => (state ? filter(kind, state.tasks) : []),
    [kind, state],
  )

  return (
    <Page>
      <Navbar
        title={TITLES[kind] ?? 'Задачи'}
        left={
          <NavbarBackLink
            text="Задачи"
            onClick={() => navigate('/')}
          />
        }
      />

      {tasks.length === 0 ? (
        <List strong inset>
          <ListItem title="Пусто" />
        </List>
      ) : (
        <List strong inset>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} showProject onEdit={setEditTask} />
          ))}
        </List>
      )}

      <TaskEditSheet
        open={editTask != null}
        onClose={() => setEditTask(null)}
        task={editTask}
      />
    </Page>
  )
}
