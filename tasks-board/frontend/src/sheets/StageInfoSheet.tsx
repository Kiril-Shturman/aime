import { useEffect, useMemo, useState } from 'react'
import { Trash2, Flag } from 'lucide-react'
import { Block, BlockTitle, Button, List, ListInput, ListItem } from 'konsta/react'
import Popup from '../components/Popup'
import PickerSheet, { type PickerOption } from './PickerSheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { TaskChips } from '../components/TaskChips'
import { STAGE_STATUS_LABEL } from '../lib/constants'
import type { Stage, StageStatus, Task } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  stage: Stage | null
}

export default function StageInfoSheet({ open, onClose, projectId, stage }: Props) {
  const { state, refresh } = useApp()
  const [status, setStatus] = useState<StageStatus>('planned')
  const [moduleName, setModuleName] = useState('')
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (stage) {
      setStatus(stage.status)
      setModuleName(stage.module ?? '')
    }
  }, [stage])

  const options: PickerOption[] = useMemo(
    () =>
      (Object.keys(STAGE_STATUS_LABEL) as StageStatus[]).map((k) => ({
        id: k,
        label: STAGE_STATUS_LABEL[k],
      })),
    [],
  )

  if (!stage) return null

  const own = state?.tasks.filter((t) => t.stage === stage.id) ?? []
  const projekt = state?.projects.find((p) => p.id === projectId)
  const kdoVzal = (t: Task) =>
    t.member
      ? projekt?.members.find((m) => m.id === t.member) ??
        state?.agents?.find((a) => a.id === t.member) ??
        null
      : null
  const meta = [
    stage.date ? `срок ${stage.date}` : null,
    stage.progress.total
      ? `задач ${stage.progress.done} из ${stage.progress.total}`
      : 'задач пока нет',
  ]
    .filter(Boolean)
    .join(' · ')

  const save = async () => {
    await api.patchStage(projectId, stage.id, {
      status,
      module: moduleName.trim(),
    })
    haptic('success')
    onClose()
    await refresh()
  }

  const remove = async () => {
    if (!confirm('Удалить этап? Задачи останутся, но потеряют привязку.')) return
    await api.deleteStage(projectId, stage.id)
    onClose()
    await refresh()
  }

  return (
    <>
      <Popup
        open={open}
        onClose={onClose}
        title={stage.title}
        onSave={save}
        canSave
      >
        <Block className="!mt-0 opacity-60 text-[13px]">{meta}</Block>

        <List strong inset>
          <ListInput
            label="Модуль"
            type="text"
            placeholder="Основной модуль"
            value={moduleName}
            onChange={(e) => setModuleName((e.target as HTMLInputElement).value)}
          />
          <ListItem
            onClick={() => setPicking(true)}
            media={<Flag size={20} />}
            title="Статус"
            after={STAGE_STATUS_LABEL[status]}
            chevron
          />
        </List>

        <BlockTitle>
          Задачи этапа
          <span className="ml-2 font-normal opacity-50">{own.length}</span>
        </BlockTitle>
        <List strong inset dividers>
          {own.length === 0 && (
            <ListItem title="Задач нет — попроси агента разложить цель" />
          )}
          {own.map((t) => (
            <ListItem
              key={t.id}
              title={<span className="leading-snug">{t.title}</span>}
              text={<TaskChips task={t} member={kdoVzal(t)} />}
            />
          ))}
        </List>

        <Block>
          <Button large rounded onClick={save}>
            Сохранить
          </Button>
        </Block>
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
            <Trash2 size={18} className="mr-2" /> Удалить этап
          </Button>
        </Block>
      </Popup>

      <PickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Статус этапа"
        options={options}
        value={status}
        onPick={(v) => v && setStatus(v as StageStatus)}
        allowClear={false}
      />
    </>
  )
}
