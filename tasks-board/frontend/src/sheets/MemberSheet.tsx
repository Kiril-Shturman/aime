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
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setKind('bot')
    setName('')
    setRole('')
    setHandle('')
    setRef('')
    setNote('')
  }, [open])

  // из ссылки t.me/MyBot видно имя — не заставляем набирать его руками
  const onRef = (value: string) => {
    setRef(value)
    const guess = value.trim().replace(/^https?:\/\//, '').replace(/^t\.me\//, '')
    const user = guess.replace(/^@/, '').split(/[?/]/)[0]
    if (!name.trim() && /^[A-Za-z0-9_]{4,32}$/.test(user) && !value.includes(':')) {
      setName(user)
      setHandle('@' + user)
    }
  }

  const save = async () => {
    if (!name.trim()) return
    const member = await api.addMember(projectId, {
      kind,
      name: name.trim(),
      role: role.trim() || undefined,
      handle: handle.trim() || undefined,
    })
    // бота сразу пробуем подключить: ссылка запомнит имя, токен даст управление
    if (kind === 'bot' && ref.trim()) {
      try {
        await api.connectBot(projectId, member.id, ref.trim())
      } catch (e) {
        setNote(
          'Участник заведён, но подключить не вышло: ' +
            String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''),
        )
        await refresh()
        return
      }
    }
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
              className="!text-[14px] whitespace-nowrap"
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
        {kind === 'bot' && (
          <ListInput
            label="Ссылка или токен"
            type="text"
            placeholder="t.me/MyBot или 12345:AA…"
            value={ref}
            onChange={(e) => onRef((e.target as HTMLInputElement).value)}
          />
        )}
      </List>

      {kind === 'bot' && (
        <Block className="!mt-0">
          <p className="text-white/45 text-[14px] leading-snug">
            По ссылке доска запомнит имя бота. Управлять им — писать сообщения,
            менять меню — получится с токеном от @BotFather.
          </p>
        </Block>
      )}

      {note && (
        <Block className="!mt-0">
          <p className="text-[14px] leading-snug text-[#ff9f0a]">{note}</p>
        </Block>
      )}

      <Block>
        <Button large rounded onClick={save}>
          Добавить
        </Button>
      </Block>
    </Sheet>
  )
}
