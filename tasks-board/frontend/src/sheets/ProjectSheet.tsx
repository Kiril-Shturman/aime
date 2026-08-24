import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Block, Button, List, ListInput } from 'konsta/react'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { COLORS } from '../lib/constants'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import type { Project } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  project?: Project | null
}

export default function ProjectSheet({ open, onClose, project }: Props) {
  const { state, refresh } = useApp()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [repo, setRepo] = useState('')
  const [color, setColor] = useState(COLORS[0])

  useEffect(() => {
    if (!open) return
    if (project) {
      setName(project.name)
      setNote(project.note ?? '')
      setRepo(project.repo ?? '')
      setColor(project.color ?? COLORS[0])
    } else {
      setName('')
      setNote('')
      setRepo('')
      setColor(COLORS[(state?.projects.length ?? 0) % COLORS.length])
    }
  }, [open, project, state?.projects.length])

  const save = async () => {
    if (!name.trim()) return
    const body = {
      name: name.trim(),
      color,
      note: note.trim(),
      repo: repo.trim(),
    }
    if (project) await api.patchProject(project.id, body)
    else await api.addProject(body)
    haptic('success')
    onClose()
    await refresh()
  }

  const title = project ? 'Изменить проект' : 'Новый проект'
  const okLabel = project ? 'Сохранить' : 'Создать'

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <List strong inset>
        <ListInput
          label="Название"
          type="text"
          placeholder="Например, Коридор"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Описание"
          type="textarea"
          placeholder="Пара слов, о чём проект"
          value={note}
          onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
        <ListInput
          label="Репозиторий"
          type="text"
          placeholder="git@github.com:… или ссылка"
          value={repo}
          onChange={(e) => setRepo((e.target as HTMLInputElement).value)}
        />
      </List>

      <Block>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: c }}
            >
              {c === color && <Check size={16} color="#fff" />}
            </button>
          ))}
        </div>
      </Block>

      <Block>
        <Button large rounded onClick={save}>
          {okLabel}
        </Button>
      </Block>
    </Sheet>
  )
}
