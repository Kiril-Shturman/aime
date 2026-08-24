import { useEffect, useState } from 'react'
import { Check, GitBranch, Palette, Plus, Trash2, Rocket } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
  Segmented,
  SegmentedButton,
  Toggle,
} from 'konsta/react'
import { Cell, IconContainer } from '@telegram-apps/telegram-ui'
import Popup from '../components/Popup'
import Sheet from '../components/Sheet'
import { Avatar } from '../components/Avatar'
import { api } from '../api/client'
import { COLORS, KINDS, kindLabel } from '../lib/constants'
import { WORKSPACE_KINDS, workspaceKindFor } from '../lib/workspace-kinds'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import type { Member, MemberKind, Project } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  project?: Project | null
}

type Draft = { kind: MemberKind; name: string; handle?: string; role?: string }

function repoShort(url: string) {
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/)
  return m ? m[1] : url
}

export default function ProjectSheet({ open, onClose, project }: Props) {
  const { state, refresh } = useApp()

  const [text, setText] = useState('')
  const [pro, setPro] = useState(false)
  const [color, setColor] = useState(COLORS[0])
  const [kindId, setKindId] = useState<string>('project')
  const [repo, setRepo] = useState('')

  // общее
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [sub, setSub] = useState<null | 'color' | 'repo'>(null)
  const [repoDraft, setRepoDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setSub(null)
    setDrafts([])
    if (project) {
      const base = project.name
      const nt = project.note ?? ''
      setText(nt ? `${base}\n${nt}` : base)
      setColor(project.color ?? COLORS[0])
      setKindId(workspaceKindFor(project.type, project.process_kind).id)
      setRepo(project.repo ?? '')
      setPro(false)
    } else {
      setText('')
      setColor(COLORS[(state?.projects.length ?? 0) % COLORS.length])
      setKindId('project')
      setRepo('')
      setPro(false)
    }
  }, [open, project, state?.projects.length])

  const canSave = !!text.trim()

  const save = async () => {
    if (!canSave) return
    const trimmed = text.trim()
    const [firstLine, ...rest] = trimmed.split('\n')
    const kind = WORKSPACE_KINDS.find((k) => k.id === kindId) ?? WORKSPACE_KINDS[0]
    const payload: Partial<Project> = {
      name: firstLine.trim(),
      note: rest.join('\n').trim(),
      // в проф-режиме — то, что руками выставили; иначе цвет по умолчанию
      color: pro ? color : COLORS[(state?.projects.length ?? 0) % COLORS.length],
      repo: pro ? repo.trim() : undefined,
      type: pro ? kind.type : undefined,
      process_kind: pro ? kind.processKind : undefined,
    }
    if (project) {
      await api.patchProject(project.id, payload)
    } else {
      const created = await api.addProject(payload)
      for (const d of drafts) {
        try {
          await api.addMember(created.id, d)
        } catch {
          /* пропускаем */
        }
      }
    }
    haptic('success')
    onClose()
    await refresh()
  }

  const removeDraft = (i: number) =>
    setDrafts((ds) => ds.filter((_, j) => j !== i))

  const togglePro = () => setPro((v) => !v)

  return (
    <>
      <Popup
        open={open}
        onClose={onClose}
        title={project ? 'Проект' : 'Создать'}
        onSave={save}
        canSave={canSave}
      >
        {/* Хедер + переключатель проф-режима — в одной карточке, всегда виден */}
        <Block strong inset className="!p-0 overflow-hidden">
          <Cell
            multiline
            before={
              <IconContainer style={{ padding: '0 6px' }}>
                <Rocket size={34} strokeWidth={1.7} />
              </IconContainer>
            }
            description={
              <>
                Проект — это отдельное пространство, где агент выполняет
                связанную работу, хранит контекст и управляет задачами.{' '}
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="text-[#4ea3ff]"
                >
                  Что это
                </a>
              </>
            }
          >
            Проект
          </Cell>

          <div className="border-t border-white/[.08]" />
          <label className="flex items-center px-4 py-3 cursor-pointer">
            <span className="flex-1 text-white text-[17px]">
              Профессиональный режим
            </span>
            <Toggle checked={pro} onChange={togglePro} />
          </label>
        </Block>
        <BlockFooter inset className="!text-[13px]">
          В проф-режиме сам выберешь тип, цвет и подключишь репозиторий —
          обычно этим занимается агент.
        </BlockFooter>

        {/* Форма ввода — одна и та же в обоих режимах, всегда на этом месте */}
        <BlockTitle>Описание</BlockTitle>
        <Block strong inset>
          <textarea
            autoFocus
            rows={6}
            placeholder="Например: сделать посадку под новую услугу, собрать 20 заявок за неделю"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
          />
        </Block>

        {!project && (
          <>
            <BlockTitle>Команда</BlockTitle>
            <List strong inset>
              {drafts.map((d, i) => (
                <ListItem
                  key={i}
                  media={
                    <Avatar
                      member={
                        {
                          id: `d${i}`,
                          name: d.name,
                          handle: d.handle,
                          kind: d.kind,
                        } as Member
                      }
                    />
                  }
                  title={d.name}
                  subtitle={
                    [d.handle, kindLabel(d.kind)].filter(Boolean).join(' · ')
                  }
                  after={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeDraft(i)
                      }}
                      className="w-8 h-8 flex items-center justify-center text-red-400 active:opacity-60"
                      aria-label="Убрать"
                    >
                      <Trash2 size={16} />
                    </button>
                  }
                />
              ))}
              <ListItem
                onClick={() => setAddOpen(true)}
                media={
                  <span className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center">
                    <Plus size={18} />
                  </span>
                }
                title="Добавить участника"
                subtitle="бот, ИИ-агент, сервис или человек"
                chevron
              />
            </List>
            <BlockFooter inset className="!text-[13px]">
              Если добавишь бота — агент допросит его о проекте сам.
            </BlockFooter>
          </>
        )}

        {pro && (
          <>
            <BlockTitle>Что заводим</BlockTitle>
            <List strong inset>
              {WORKSPACE_KINDS.map((k) => {
                const Icon = k.Icon
                const active = kindId === k.id
                return (
                  <ListItem
                    key={k.id}
                    onClick={() => setKindId(k.id)}
                    media={
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          active
                            ? 'bg-[#2a8bff] text-white'
                            : 'bg-white/10 text-white'
                        }`}
                      >
                        <Icon size={18} />
                      </span>
                    }
                    title={k.label}
                    subtitle={k.hint}
                    after={
                      active ? (
                        <span className="flex items-center justify-center h-full">
                          <Check
                            size={20}
                            className="text-[#2a8bff]"
                            strokeWidth={3}
                          />
                        </span>
                      ) : undefined
                    }
                  />
                )
              })}
            </List>

            <BlockTitle>Оформление</BlockTitle>
            <List strong inset>
              <ListItem
                onClick={() => setSub('color')}
                media={<Palette size={20} />}
                title="Цвет"
                after={
                  <span
                    className="w-6 h-6 rounded-full border border-white/10"
                    style={{ background: color }}
                  />
                }
                chevron
              />
            </List>

            <BlockTitle>Репозиторий</BlockTitle>
            <List strong inset>
              <ListItem
                onClick={() => {
                  setRepoDraft(repo)
                  setSub('repo')
                }}
                media={<GitBranch size={20} />}
                title={repo ? repoShort(repo) : 'Не указан'}
                subtitle={repo ? repo : 'нажми, чтобы подключить'}
                chevron
              />
            </List>
          </>
        )}

      </Popup>

      <MemberDraftSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(d) => setDrafts((ds) => [...ds, d])}
      />

      {/* Sub-sheet: Repo URL */}
      <Sheet open={sub === 'repo'} onClose={() => setSub(null)} title="Репозиторий">
        <List strong inset>
          <ListInput
            label="Адрес"
            type="text"
            placeholder="git@github.com:user/repo.git"
            value={repoDraft}
            onChange={(e) => setRepoDraft((e.target as HTMLInputElement).value)}
          />
        </List>
        <Block className="flex gap-2">
          <Button
            large
            rounded
            outline
            onClick={() => {
              setRepo('')
              setSub(null)
            }}
          >
            Убрать
          </Button>
          <Button
            large
            rounded
            onClick={() => {
              setRepo(repoDraft.trim())
              setSub(null)
            }}
          >
            Готово
          </Button>
        </Block>
      </Sheet>

      {/* Sub-sheet: Color */}
      <Sheet open={sub === 'color'} onClose={() => setSub(null)} title="Цвет">
        <Block>
          <div className="grid grid-cols-4 gap-3 justify-items-center">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c)
                  setSub(null)
                }}
                className="w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: c }}
              >
                {c === color && <Check size={24} color="#fff" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Block>
      </Sheet>
    </>
  )
}

function MemberDraftSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (d: Draft) => void
}) {
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

  const add = () => {
    const nm = name.trim() || handle.trim().replace(/^@/, '')
    if (!nm) return
    onAdd({
      kind,
      name: nm,
      handle: handle.trim() || undefined,
      role: role.trim() || undefined,
    })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Участник">
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
          placeholder="За что отвечает"
          value={role}
          onChange={(e) => setRole((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Telegram"
          type="text"
          placeholder="@handle"
          value={handle}
          onChange={(e) => setHandle((e.target as HTMLInputElement).value)}
        />
      </List>

      <Block>
        <Button large rounded onClick={add}>
          Добавить
        </Button>
      </Block>
    </Sheet>
  )
}
