import { useEffect, useMemo, useState } from 'react'
import { Check, X, Calendar, Clock, AlarmClock, User, Folder } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListInput,
  ListItem,
  Toggle,
} from 'konsta/react'
import Sheet from '../components/Sheet'
import PickerSheet, { type PickerOption } from './PickerSheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  defaultProject?: string | null
  defaultStage?: string | null
}

type Picker = null | 'project' | 'member' | 'stage'

export default function TaskSheet({
  open,
  onClose,
  defaultProject = null,
  defaultStage = null,
}: Props) {
  const { state, refresh } = useApp()

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [projectId, setProjectId] = useState<string | null>(defaultProject)
  const [stageId, setStageId] = useState<string | null>(defaultStage)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [hasDate, setHasDate] = useState(false)
  const [due, setDue] = useState('')
  const [hasTime, setHasTime] = useState(false)
  const [time, setTime] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [picker, setPicker] = useState<Picker>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNote('')
    setUrl('')
    setProjectId(defaultProject ?? state?.projects[0]?.id ?? null)
    setStageId(defaultStage)
    setMemberId(null)
    setHasDate(false)
    setDue('')
    setHasTime(false)
    setTime('')
    setFlagged(false)
  }, [open, defaultProject, defaultStage, state?.projects])

  const project = state?.projects.find((p) => p.id === projectId) ?? null
  const stage = project?.roadmap.find((s) => s.id === stageId) ?? null
  const member = project?.members.find((m) => m.id === memberId) ?? null

  const projectOptions: PickerOption[] = useMemo(
    () => state?.projects.map((p) => ({ id: p.id, label: p.name })) ?? [],
    [state?.projects],
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
  const stageOptions: PickerOption[] = useMemo(
    () => project?.roadmap.map((s) => ({ id: s.id, label: s.title })) ?? [],
    [project],
  )

  const save = async () => {
    if (!title.trim()) return
    await api.addTask({
      title: title.trim(),
      note: note.trim() || undefined,
      url: url.trim() || undefined,
      project: projectId ?? undefined,
      stage: stageId ?? undefined,
      member: memberId ?? undefined,
      due: hasDate && due ? due : undefined,
      time: hasTime && time ? time : undefined,
      flagged: flagged || undefined,
    })
    haptic('success')
    onClose()
    await refresh()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Новая задача"
        headerLeft={
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center active:opacity-70"
          >
            <X size={16} />
          </button>
        }
        headerRight={
          <button
            onClick={save}
            className="w-8 h-8 rounded-full bg-[#2a8bff] flex items-center justify-center text-white active:bg-[#1f7de6]"
          >
            <Check size={18} strokeWidth={3} />
          </button>
        }
      >
        <List strong inset>
          <ListInput
            type="text"
            placeholder="Название"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
          <ListInput
            type="textarea"
            placeholder="Заметки"
            value={note}
            onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
          <ListInput
            type="text"
            placeholder="Ссылка"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </List>

        <BlockTitle>Дата и срочность</BlockTitle>
        <List strong inset>
          <ListItem
            media={<Calendar size={20} />}
            title="Дата"
            after={
              <Toggle
                checked={hasDate}
                onChange={(e) => setHasDate((e.target as HTMLInputElement).checked)}
              />
            }
          />
          {hasDate && (
            <ListInput
              type="date"
              value={due}
              onChange={(e) => setDue((e.target as HTMLInputElement).value)}
            />
          )}
          <ListItem
            media={<Clock size={20} />}
            title="Время"
            after={
              <Toggle
                checked={hasTime}
                onChange={(e) => setHasTime((e.target as HTMLInputElement).checked)}
              />
            }
          />
          {hasTime && (
            <ListInput
              type="time"
              value={time}
              onChange={(e) => setTime((e.target as HTMLInputElement).value)}
            />
          )}
          <ListItem
            media={<AlarmClock size={20} />}
            title="Срочное"
            after={
              <Toggle
                checked={flagged}
                onChange={(e) => setFlagged((e.target as HTMLInputElement).checked)}
              />
            }
          />
        </List>
        <Block className="!mt-2 opacity-60 text-[13px]">
          Срочная задача поднимается наверх и помечается флажком.
        </Block>

        <BlockTitle>Другие параметры</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setPicker('project')}
            media={<Folder size={20} />}
            title="Проект"
            after={project?.name ?? '—'}
            chevron
          />
          {project && project.roadmap.length > 0 && (
            <ListItem
              onClick={() => setPicker('stage')}
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
      </Sheet>

      <PickerSheet
        open={picker === 'project'}
        onClose={() => setPicker(null)}
        title="Проект"
        options={projectOptions}
        value={projectId}
        onPick={(v) => {
          setProjectId(v)
          setStageId(null)
          setMemberId(null)
        }}
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
