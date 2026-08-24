import { useEffect, useMemo, useState } from 'react'
import { Calendar, Clock, AlarmClock, User, Folder, Link as LinkIcon } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListInput,
  ListItem,
  Toggle,
} from 'konsta/react'
import Popup from '../components/Popup'
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
      <Popup open={open} onClose={onClose} title="Новая задача" onSave={save} saveLabel="Готово">
        <Block strong inset className="!mt-3">
          <input
            autoFocus
            type="text"
            placeholder=""
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-transparent text-white text-[22px] font-semibold outline-none placeholder:text-white/40"
          />
          <textarea
            rows={3}
            placeholder="Заметки"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-3 w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
          />
        </Block>

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
          <ListInput
            media={<LinkIcon size={20} />}
            type="text"
            placeholder="Ссылка"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </List>
      </Popup>

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
