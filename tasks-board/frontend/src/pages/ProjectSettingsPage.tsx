import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Copy, Check } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  Link as KLink,
  List,
  ListInput,
  ListItem,
  Navbar,
  Page,
} from 'konsta/react'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { Avatar } from '../components/Avatar'
import Pill from '../components/Pill'
import { COLORS } from '../lib/constants'

// Настройки проекта: имя, цвет, где лежит код и дизайн-код — правила,
// по которым агенты делают интерфейс. Агент читает их через board_design.
export default function ProjectSettingsPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state, refresh } = useApp()
  const project = state?.projects.find((p) => p.id === id) ?? null

  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [repo, setRepo] = useState('')
  const [path, setPath] = useState('')
  const [design, setDesign] = useState('')
  const [zkopirovano, setZkopirovano] = useState(false)
  const [ulozeno, setUlozeno] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name)
    setNote(project.note ?? '')
    setColor(project.color ?? COLORS[0])
    setRepo(project.repo ?? '')
    setPath(project.path ?? '')
    setDesign(project.design ?? '')
  }, [project?.id])

  if (!project) {
    return (
      <Page>
        <Navbar title="Настройки" left={<KLink onClick={() => navigate(-1)}><ChevronLeft size={22} /></KLink>} />
        <Block>{state ? 'Такого проекта нет.' : 'Загружаем…'}</Block>
      </Page>
    )
  }

  const ulozit = async () => {
    haptic('success')
    await api.patchProject(project.id, {
      name: name.trim() || project.name,
      note: note.trim(),
      color,
      repo: repo.trim(),
      path: path.trim(),
      design: design.trim(),
    })
    await refresh()
    setUlozeno(true)
    window.setTimeout(() => setUlozeno(false), 1500)
  }

  const kopirovat = async () => {
    haptic('light')
    try {
      await navigator.clipboard.writeText(design)
      setZkopirovano(true)
      window.setTimeout(() => setZkopirovano(false), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Page>
      <Navbar
        title="Настройки"
        left={
          <KLink onClick={() => navigate(`/project/${project.id}`)}>
            <ChevronLeft size={22} />
          </KLink>
        }
        right={
          <KLink onClick={ulozit} className="!text-primary font-semibold">
            {ulozeno ? <Check size={22} strokeWidth={3} /> : 'Сохранить'}
          </KLink>
        }
      />

      <List strong inset>
        <ListInput
          label="Название"
          type="text"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="О чём проект"
          type="textarea"
          placeholder="Одной строкой: что это и зачем"
          value={note}
          onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
      </List>

      <BlockTitle>Цвет</BlockTitle>
      <Block className="!mt-3">
        <div className="flex flex-wrap gap-3 pt-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              onClick={() => setColor(c)}
              className="h-9 w-9 rounded-full active:opacity-70"
              style={{ background: c }}
            >
              {color === c && <Check size={18} className="mx-auto text-white" />}
            </button>
          ))}
        </div>
      </Block>

      <BlockTitle>Где лежит код</BlockTitle>
      <List strong inset>
        <ListInput
          label="Репозиторий"
          type="text"
          placeholder="git@github.com:кто/что.git"
          value={repo}
          onChange={(e) => setRepo((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Папка у агента"
          type="text"
          placeholder="~/projects/имя"
          value={path}
          onChange={(e) => setPath((e.target as HTMLInputElement).value)}
        />
      </List>
      <BlockFooter>
        По этим двум полям агент находит исходники и показывает историю гита.
      </BlockFooter>

      <BlockTitle>
        Дизайн-код
        <span className="ml-2 font-normal opacity-50">читают агенты</span>
      </BlockTitle>
      <List strong inset>
        <ListInput
          type="textarea"
          inputClassName="!min-h-[280px] !text-[14px] !leading-snug"
          placeholder="Из чего собираем интерфейс"
          value={design}
          onChange={(e) => setDesign((e.target as HTMLTextAreaElement).value)}
        />
      </List>
      <Block className="!mt-2 grid gap-2">
        <Button large rounded onClick={ulozit}>
          Сохранить
        </Button>
        <Button large rounded clear onClick={kopirovat}>
          {zkopirovano ? <Check size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
          Скопировать дизайн-код
        </Button>
      </Block>
      <BlockFooter>
        Агент забирает этот текст командой board_design перед любой правкой
        интерфейса — так все работают одними и теми же компонентами.
      </BlockFooter>

      <BlockTitle>Команда</BlockTitle>
      <List strong inset>
        {project.members.length === 0 && <ListItem title="Пока никого" />}
        {project.members.map((m) => (
          <ListItem
            key={m.id}
            media={<Avatar member={m} color={project.color} size={36} />}
            title={m.name}
            subtitle={m.role || undefined}
            after={
              m.job === 'check' ? (
                <Pill tone="free">проверяет</Pill>
              ) : m.auto === false ? (
                <Pill tone="free">новых не берёт</Pill>
              ) : undefined
            }
          />
        ))}
      </List>
    </Page>
  )
}
