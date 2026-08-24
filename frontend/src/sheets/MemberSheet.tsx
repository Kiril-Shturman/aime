import { useEffect, useState } from 'react'
import {
  Block,
  Button,
  List,
  ListInput,
  Segmented,
  SegmentedButton,
} from 'konsta/react'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { KINDS } from '../lib/constants'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import type { MemberKind } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
}

export default function MemberSheet({ open, onClose, projectId }: Props) {
  const { refresh } = useApp()
  const [kind, setKind] = useState<MemberKind>('bot')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [handle, setHandle] = useState('')

  useEffect(() => {
    if (!open) return
    setKind('bot')
    setName('')
    setRole('')
    setHandle('')
  }, [open])

  const save = async () => {
    if (!name.trim()) return
    await api.addMember(projectId, {
      kind,
      name: name.trim(),
      role: role.trim() || undefined,
      handle: handle.trim() || undefined,
    })
    haptic('success')
    onClose()
    await refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Участник проекта">
      <Block>
        <Segmented strong rounded>
          {KINDS.map((k) => (
            <SegmentedButton
              key={k.id}
              active={kind === k.id}
              onClick={() => setKind(k.id as MemberKind)}
            >
              {k.label}
            </SegmentedButton>
          ))}
        </Segmented>
      </Block>

      <List strong inset>
        <ListInput
          label="Имя"
          type="text"
          placeholder="Как называем"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Роль"
          type="text"
          placeholder="Например, отвечает за продажи"
          value={role}
          onChange={(e) => setRole((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Ник в Телеграме"
          type="text"
          placeholder="@username"
          value={handle}
          onChange={(e) => setHandle((e.target as HTMLInputElement).value)}
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
