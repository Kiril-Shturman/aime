import { useEffect, useState } from 'react'
import { Block, Button, List, ListInput } from 'konsta/react'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
}

export default function StageSheet({ open, onClose, projectId }: Props) {
  const { refresh } = useApp()
  const [moduleName, setModuleName] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')

  useEffect(() => {
    if (!open) return
    setModuleName('')
    setTitle('')
    setDate('')
  }, [open])

  const save = async () => {
    if (!title.trim()) return
    await api.addStage(projectId, {
      module: moduleName.trim() || undefined,
      title: title.trim(),
      date: date || undefined,
      status: 'planned',
    })
    haptic('success')
    onClose()
    await refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Новый этап">
      <List strong inset>
        <ListInput
          label="Модуль"
          type="text"
          placeholder="Основной модуль"
          value={moduleName}
          onChange={(e) => setModuleName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Название этапа"
          type="text"
          placeholder="Например, Закрытая бета"
          value={title}
          onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Срок"
          type="date"
          value={date}
          onChange={(e) => setDate((e.target as HTMLInputElement).value)}
        />
      </List>
      <Block>
        <Button large rounded onClick={save}>
          Добавить
        </Button>
      </Block>
    </Sheet>
  )
}
