import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Clock, AlarmClock, User, Folder, Link as LinkIcon } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListInput,
  ListItem,
  Toggle,
} from 'konsta/react'
import { DayPicker } from 'react-day-picker'
import { ru } from 'date-fns/locale'
import 'react-day-picker/style.css'
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

  const [text, setText] = useState('')
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

  const dateRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)

  const openPicker = (el: HTMLInputElement | null) => {
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.click()
  }

  const fmtDate = (s: string) => {
    if (!s) return 'Выбрать'
    const d = new Date(s)
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  useEffect(() => {
    if (!open) return
    setText('')
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
    const trimmed = text.trim()
    if (!trimmed) return
    const [firstLine, ...rest] = trimmed.split('\n')
    const title = firstLine.trim()
    const note = rest.join('\n').trim()
    await api.addTask({
      title,
      note: note || undefined,
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
      <Popup
        open={open}
        onClose={onClose}
        title="Новая задача"
        onSave={save}
        canSave={!!text.trim()}
      >
        <Block strong inset className="!mt-3">
          <textarea
            autoFocus
            rows={6}
            placeholder="Что нужно сделать?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
          />
        </Block>

        <BlockTitle>Дата и срочность</BlockTitle>
        <List strong inset>
          <ListItem
            media={<Calendar size={20} />}
            title="Дата"
            after={
              <span className="flex items-center gap-3">
                {hasDate && (
                  <span className="text-[#4ea3ff] text-[15px]">{fmtDate(due)}</span>
                )}
                <Toggle
                  checked={hasDate}
                  onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked
                    setHasDate(on)
                    if (!on) setDue('')
                  }}
                />
              </span>
            }
          />
          {/* календарь пойдёт отдельным блоком ниже, чтобы растянуться на ширину */}
          <ListItem
            media={<Clock size={20} />}
            title="Время"
            after={
              <Toggle
                checked={hasTime}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked
                  setHasTime(on)
                  if (on) setTimeout(() => openPicker(timeRef.current), 0)
                  else setTime('')
                }}
              />
            }
          />
          {hasTime && (
            <ListItem
              title={time || 'Выбрать'}
              onClick={() => openPicker(timeRef.current)}
              className="!ps-13"
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

        {hasDate && (
          <Block strong inset className="!p-2">
            <DayPicker
              mode="single"
              locale={ru}
              weekStartsOn={1}
              selected={due ? new Date(due) : undefined}
              onSelect={(d) => {
                if (!d) return
                const iso = new Date(
                  d.getTime() - d.getTimezoneOffset() * 60000,
                )
                  .toISOString()
                  .slice(0, 10)
                setDue(iso)
              }}
              className="rdp-tasks"
            />
          </Block>
        )}

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

      {/* скрытые нативные пикеры даты и времени — их вызываем через showPicker() */}
      <input
        ref={dateRef}
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        className="sr-only pointer-events-none"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={timeRef}
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="sr-only pointer-events-none"
        tabIndex={-1}
        aria-hidden
      />

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
