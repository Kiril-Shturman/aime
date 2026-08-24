import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
  Segmented,
  SegmentedButton,
} from 'konsta/react'
import Sheet from '../components/Sheet'
import { Avatar } from '../components/Avatar'
import MemberConnect from '../components/MemberConnect'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { KINDS, kindLabel, TASK_STATUS_LABEL } from '../lib/constants'
import type { Member, MemberKind } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  member: Member | null
  projectColor?: string
}

export default function MemberInfoSheet({
  open,
  onClose,
  projectId,
  member,
  projectColor,
}: Props) {
  const { state, refresh } = useApp()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [handle, setHandle] = useState('')
  const [kind, setKind] = useState<MemberKind>('bot')

  useEffect(() => {
    if (!member) return
    setName(member.name ?? '')
    setRole(member.role ?? '')
    setHandle(member.handle ?? '')
    setKind(member.kind ?? 'bot')
  }, [member])

  if (!member) return null

  const own = state?.tasks.filter((t) => t.member === member.id) ?? []
  const done = own.filter((t) => t.done)
  const tokens = own.reduce((s, t) => s + (t.tokens ?? 0), 0)

  const save = async () => {
    await api.patchMember(projectId, member.id, {
      name: name.trim(),
      role: role.trim() || undefined,
      handle: handle.trim() || undefined,
      kind,
    })
    haptic('success')
    onClose()
    await refresh()
  }

  const remove = async () => {
    if (!confirm('Убрать участника из проекта? Его задачи останутся.')) return
    await api.deleteMember(projectId, member.id)
    onClose()
    await refresh()
  }

  return (
    <Sheet open={open} onClose={onClose} title={member.name}>
      <Block className="!mt-0">
        <div className="flex items-center gap-3 mb-3">
          <Avatar member={member} color={projectColor} size={48} />
          <div>
            <div className="text-[17px] font-semibold">{member.name}</div>
            <div className="opacity-60 text-[13px]">
              {member.role || kindLabel(member.kind)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat title="в работе" value={String(own.length - done.length)} />
          <Stat title="закрыто" value={String(done.length)} />
          <Stat title="токенов" value={tokens ? String(tokens) : '—'} />
        </div>
      </Block>

      <MemberConnect member={member} />

      <BlockTitle>Кто это</BlockTitle>
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
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Роль"
          type="text"
          value={role}
          onChange={(e) => setRole((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="@username"
          type="text"
          value={handle}
          onChange={(e) => setHandle((e.target as HTMLInputElement).value)}
        />
      </List>

      {own.length > 0 && (
        <>
          <BlockTitle>Задачи участника</BlockTitle>
          <List strong inset>
            {own.slice(0, 6).map((t) => (
              <ListItem
                key={t.id}
                title={t.title}
                subtitle={TASK_STATUS_LABEL[t.status]}
              />
            ))}
          </List>
        </>
      )}

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
          <Trash2 size={18} className="mr-2" /> Убрать из проекта
        </Button>
      </Block>
    </Sheet>
  )
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-black/[.06] dark:bg-white/[.06] rounded-xl px-3 py-3">
      <div className="text-[20px] font-bold">{value}</div>
      <div className="opacity-60 text-[12px] mt-0.5">{title}</div>
    </div>
  )
}
