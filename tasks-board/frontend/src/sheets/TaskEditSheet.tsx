import { useEffect, useMemo, useState } from 'react'
import { Flag, User, ListChecks, Trash2 } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
} from 'konsta/react'
import Popup from '../components/Popup'
import PickerSheet, { type PickerOption } from './PickerSheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { TASK_STATUS_LABEL } from '../lib/constants'
import type { Task, TaskStatus } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  task: Task | null
}

type Picker = null | 'status' | 'stage' | 'member'

export default function TaskEditSheet({ open, onClose, task }: Props) {
  const { state, refresh } = useApp()

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [stageId, setStageId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [report, setReport] = useState('')
  const [picker, setPicker] = useState<Picker>(null)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setStatus(task.status)
    setStageId(task.stage ?? null)
    setMemberId(task.member ?? null)
    setReport(task.report ?? '')
  }, [task])

  const project = state?.projects.find((p) => p.id === task?.project) ?? null
  const stage = project?.roadmap.find((s) => s.id === stageId) ?? null
  const member = project?.members.find((m) => m.id === memberId) ?? null

  const stageOptions: PickerOption[] = useMemo(
    () => project?.roadmap.map((s) => ({ id: s.id, label: s.title })) ?? [],
    [project],
  )
  const memberOptions: PickerOption[] = useMemo(
    () =>
      project?.members.map((m) => ({
        id: m.id,
        label: m.name,
        sub: m.handle ?? m.role,
      })) ?? [],
    [project],
  )
  const statusOptions: PickerOption[] = useMemo(
    () =>
      (Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((k) => ({
        id: k,
        label: TASK_STATUS_LABEL[k],
      })),
    [],
  )

  const save = async () => {
    if (!task) return
    await api.patchTask(task.id, {
      title: title.trim() || task.title,
      status,
      stage: stageId ?? undefined,
      member: memberId ?? undefined,
      report: report.trim() || undefined,
    })
    haptic('success')
    onClose()
    await refresh()
  }

  const remove = async () => {
    if (!task) return
    if (!confirm('Удалить задачу?')) return
    await api.deleteTask(task.id)
    onClose()
    await refresh()
  }

  if (!task) return null

  return (
    <>
      <Popup
        open={open}
        onClose={onClose}
        title="Задача"
        onSave={save}
        canSave={!!title.trim()}
        pageClassName="pb-safe-10"
      >
        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Название"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <BlockTitle>Куда относится</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setPicker('status')}
            media={<ListChecks size={20} />}
            title="Статус"
            after={TASK_STATUS_LABEL[status]}
            chevron
          />
          {project && project.roadmap.length > 0 && (
            <ListItem
              onClick={() => setPicker('stage')}
              media={<Flag size={20} />}
              title="Этап"
              after={stage?.title ?? 'Без этапа'}
              chevron
            />
          )}
          <ListItem
            onClick={() => setPicker('member')}
            media={<User size={20} />}
            title="Исполнитель"
            after={member?.name ?? 'Не выбран'}
            chevron
          />
        </List>

        {task.done && (task.commit || task.tokens || task.seconds) && (
          <>
            <BlockTitle>Итог</BlockTitle>
            <List strong inset>
              {task.commit && (
                <ListItem title="Коммит" after={task.commit.slice(0, 12)} />
              )}
              {task.tokens != null && (
                <ListItem title="Токены" after={String(task.tokens)} />
              )}
              {task.seconds != null && (
                <ListItem title="Секунды" after={String(task.seconds)} />
              )}
            </List>
          </>
        )}

        <BlockTitle>Отчёт</BlockTitle>
        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Что сделано, что осталось, ссылка на результат"
            value={report}
            onChange={(e) => setReport((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <Block>
          <Button
            large
            rounded
            clear
            colors={{
            textIos: 'text-red-500',
            textMaterial: 'text-red-500',
            clearBgIos: 'bg-transparent active:bg-red-500/15',
            clearBgMaterial: 'bg-transparent',
          }}
            onClick={remove}
          >
            <Trash2 size={18} className="mr-2" /> Удалить задачу
          </Button>
        </Block>
      </Popup>

      <PickerSheet
        open={picker === 'status'}
        onClose={() => setPicker(null)}
        title="Статус"
        options={statusOptions}
        value={status}
        onPick={(v) => v && setStatus(v as TaskStatus)}
        allowClear={false}
      />
      <PickerSheet
        open={picker === 'stage'}
        onClose={() => setPicker(null)}
        title="Этап"
        options={stageOptions}
        value={stageId}
        onPick={setStageId}
        clearLabel="Без этапа"
      />
      <PickerSheet
        open={picker === 'member'}
        onClose={() => setPicker(null)}
        title="Исполнитель"
        options={memberOptions}
        value={memberId}
        onPick={setMemberId}
        clearLabel="Не выбран"
      />
    </>
  )
}
