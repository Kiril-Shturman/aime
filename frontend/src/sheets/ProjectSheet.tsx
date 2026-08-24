import { useEffect, useState } from 'react'
import { Bot, BookOpen, Check, CheckSquare, GitBranch, Palette, Plus, Rocket } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
  Toggle,
} from 'konsta/react'
import { Cell, IconContainer } from '@telegram-apps/telegram-ui'
import Popup from '../components/Popup'
import Sheet from '../components/Sheet'
import { api } from '../api/client'
import { COLORS } from '../lib/constants'
import { WORKSPACE_KINDS, workspaceKindFor } from '../lib/workspace-kinds'
import { CONTEXT_SOURCES } from '../lib/context-sources'
import ContextSourceSheet from './ContextSourceSheet'
import ConceptInfoSheet from './ConceptInfoSheet'
import ContextInfoSheet from './ContextInfoSheet'
import { haptic } from '../lib/telegram'
import { useApp } from '../store/AppStore'
import type { Project } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  project?: Project | null
}

// Ключевые понятия, из которых состоит работа в этом инструменте.
// Показываются в шапке при создании — чтобы человек с ходу понял,
// куда попал.
// Ключевые понятия, из которых состоит работа в этом инструменте.
// Показываются в шапке при создании — чтобы человек с ходу понял,
// куда попал.
export const CONCEPTS = [
  {
    id: 'project',
    label: 'Проект',
    Icon: Rocket,
    hint: 'Отдельное пространство, где агент выполняет связанную работу, хранит контекст и управляет задачами.',
    details:
      'У проекта есть два режима:\n\n• Целевой — работа идёт по этапам до конкретного результата.\n• Постоянный — работа выполняется непрерывно по правилам или расписанию.',
  },
  {
    id: 'agent',
    label: 'ИИ-агент',
    Icon: Bot,
    hint: 'Самостоятельный исполнитель, который понимает контекст, выполняет задачи, использует инструменты и накапливает опыт.',
    details:
      'Получает роль и задачи внутри проекта, самостоятельно планирует действия и сообщает о результате. Может работать с файлами, Git, интернетом, базами знаний и другими подключёнными инструментами.',
  },
  {
    id: 'context',
    label: 'Контекст',
    Icon: BookOpen,
    hint: 'Вся информация о проекте, которая помогает агенту понимать цели, учитывать историю и принимать решения.',
    details:
      'Формируется из описания проекта, документов, переписки, задач, Git-репозиториев, баз знаний и других источников. Контекст обновляется по мере работы, чтобы агент понимал текущее состояние проекта.',
  },
  {
    id: 'task',
    label: 'Задача',
    Icon: CheckSquare,
    hint: 'Отдельная единица работы с понятной целью и ожидаемым результатом, из которой складывается план проекта.',
    details:
      'Содержит описание работы, исполнителя, приоритет, срок и текущий статус. Агент может взять задачу, выполнить её с помощью доступных инструментов и оставить отчёт о результате.',
  },
] as const

export type Concept = (typeof CONCEPTS)[number]

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

  // источники контекста: id → значения полей
  const [sources, setSources] = useState<Record<string, Record<string, string>>>(
    {},
  )
  const [editSource, setEditSource] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  // какую карточку объясняем: у каждой свой разбор
  const [concept, setConcept] = useState<Concept | null>(null)
  const [sub, setSub] = useState<null | 'color' | 'repo'>(null)
  const [repoDraft, setRepoDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setSub(null)
    setSources({})
    setEditSource(null)
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
      // выбранные источники агент разберёт после создания. Пока сериализуем
      // в note — API расширим позже.
      const summary = Object.entries(sources)
        .map(([id, fields]) => {
          const parts = Object.entries(fields)
            .filter(([, v]) => v.trim())
            .map(([k, v]) => `${k}: ${v.trim()}`)
            .join('; ')
          return `- ${id}${parts ? ` (${parts})` : ''}`
        })
        .join('\n')
      const withSources = summary
        ? {
            ...payload,
            note: [payload.note, `Источники контекста:\n${summary}`]
              .filter(Boolean)
              .join('\n\n'),
          }
        : payload
      await api.addProject(withSources)
    }
    haptic('success')
    onClose()
    await refresh()
  }

  const saveSource = (id: string, values: Record<string, string>) => {
    setSources((s) => ({ ...s, [id]: values }))
    setEditSource(null)
  }
  const removeSource = (id: string) => {
    setSources((s) => {
      const next = { ...s }
      delete next[id]
      return next
    })
    setEditSource(null)
  }

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
        {/* Проект + все источники контекста — одним стеком Cell'ов */}
        <Block strong inset className="!p-0 overflow-hidden">
          {project && (
            <Cell
              multiline
              before={
                <IconContainer style={{ padding: '0 6px' }}>
                  <Rocket size={34} strokeWidth={1.7} />
                </IconContainer>
              }
              description={
                <>
                  Отдельное пространство, где агент выполняет связанную работу,
                  хранит контекст и управляет задачами.{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      setInfoOpen(true)
                    }}
                    className="text-[#4ea3ff]"
                  >
                    Что это
                  </a>
                </>
              }
            >
              Проект
            </Cell>
          )}

          {!project &&
            CONCEPTS.map((c) => {
              const Icon = c.Icon
              return (
                <div key={c.id}>
                  <div className="border-t border-white/[.08]" />
                  <Cell
                    multiline
                    before={
                      <IconContainer style={{ padding: '0 6px' }}>
                        <Icon size={34} strokeWidth={1.7} />
                      </IconContainer>
                    }
                    description={
                      <>
                        {c.hint}{' '}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            haptic('light')
                            setConcept(c)
                          }}
                          className="text-[#4ea3ff]"
                        >
                          Что это
                        </a>
                      </>
                    }
                  >
                    {c.label}
                  </Cell>
                </div>
              )
            })}

          <div className="border-t border-white/[.08]" />
          <label className="flex items-center px-4 py-3 cursor-pointer">
            <span className="flex-1 text-black dark:text-white text-[17px]">
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
            className="w-full bg-transparent text-black dark:text-white text-[17px] outline-none resize-none placeholder:text-black/40 dark:placeholder:text-white/40"
          />
        </Block>


        {!project && (
          <>
            <BlockTitle>Настройки</BlockTitle>
            <List strong inset>
              {CONTEXT_SOURCES.map((s) => {
                const active = !!sources[s.id]
                return (
                  <ListItem
                    key={s.id}
                    onClick={() => setEditSource(s.id)}
                    media={<IconContainer>{s.renderColored()}</IconContainer>}
                    title={s.label}
                    subtitle={
                      <span className="text-black/55 dark:text-white/45">{s.hint}</span>
                    }
                    after={
                      active ? (
                        <span className="text-[12px] text-black/55 dark:text-white/45 font-medium translate-y-[9px]">
                          Добавлено
                        </span>
                      ) : (
                        <span className="pl-1.5 pr-2.5 h-6 inline-flex items-center gap-0.5 rounded-full bg-[#2a8bff] text-white text-[12px] font-semibold active:opacity-70 leading-none translate-y-[9px]">
                          <Plus size={12} strokeWidth={3} />
                          Добавить
                        </span>
                      )
                    }
                  />
                )
              })}
            </List>
            <BlockFooter inset className="!text-[13px]">
              Отметь, откуда агенту взять контекст о проекте. Настроим по
              каждому источнику после создания.
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

      <ContextSourceSheet
        open={editSource !== null}
        sourceId={editSource}
        initial={editSource ? sources[editSource] ?? {} : {}}
        onClose={() => setEditSource(null)}
        onSave={(v) => editSource && saveSource(editSource, v)}
        onRemove={
          editSource && sources[editSource]
            ? () => removeSource(editSource)
            : undefined
        }
      />

      <ContextInfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
      />

      <ConceptInfoSheet
        open={!!concept}
        concept={concept}
        onClose={() => setConcept(null)}
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

