import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder } from 'lucide-react'
import { Block, BlockTitle, Button, List, ListInput, ListItem } from 'konsta/react'
import Sheet from '../components/Sheet'
import PickerSheet, { type PickerOption } from './PickerSheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  defaultProject?: string | null
}

export default function GoalSheet({ open, onClose, defaultProject = null }: Props) {
  const { state, refresh } = useApp()
  const nav = useNavigate()

  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState<string | null>(defaultProject)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!open) return
    setText('')
    setProjectId(defaultProject ?? state?.projects[0]?.id ?? null)
  }, [open, defaultProject, state?.projects])

  const project = state?.projects.find((p) => p.id === projectId) ?? null

  const options: PickerOption[] = useMemo(
    () => state?.projects.map((p) => ({ id: p.id, label: p.name })) ?? [],
    [state?.projects],
  )

  const save = async () => {
    if (!text.trim()) return
    const out = await api.addGoal(text.trim(), projectId ?? undefined)
    haptic('success')
    onClose()
    await refresh()
    if (out?.project) nav(`/project/${out.project}`)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Новая цель">
        <Block className="!mt-0 !mb-3 opacity-60 text-[13px]">
          Опиши словами, что нужно получить. Разложить на задачи — забота агента.
        </Block>

        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Например: доделать доску задач — пустые экраны, анимация, расписание"
            value={text}
            onChange={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <BlockTitle>Проект</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setPicking(true)}
            title={project?.name ?? '—'}
            media={
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: project?.color ?? '#48484a' }}
              >
                <Folder size={16} className="text-white" />
              </span>
            }
            chevron
          />
        </List>

        <Block>
          <Button large rounded onClick={save}>
            Поставить цель
          </Button>
        </Block>
      </Sheet>

      <PickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Проект"
        options={options}
        value={projectId}
        onPick={setProjectId}
        allowClear={false}
      />
    </>
  )
}
