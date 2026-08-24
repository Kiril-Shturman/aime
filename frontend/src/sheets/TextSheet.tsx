import { useEffect, useState } from 'react'
import { Block, Button, List, ListInput } from 'konsta/react'
import Sheet from '../components/Sheet'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  label?: string
  placeholder?: string
  value: string
  multiline?: boolean
  onSave: (value: string) => void | Promise<void>
}

// Один лист на все короткие текстовые настройки: часы работы, автоответ,
// кому эскалировать. Плодить по листу на поле незачем.
export default function TextSheet({
  open,
  onClose,
  title,
  label,
  placeholder,
  value,
  multiline,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const save = async () => {
    haptic('success')
    await onSave(draft.trim())
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <List strongIos insetIos>
        <ListInput
          type={multiline ? 'textarea' : 'text'}
          label={label}
          placeholder={placeholder}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          inputClassName={multiline ? '!h-24' : undefined}
        />
      </List>
      <Block>
        <Button large rounded onClick={save}>
          Сохранить
        </Button>
      </Block>
    </Sheet>
  )
}
