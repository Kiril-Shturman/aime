import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AudioLines,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  List,
  ListItem,
  Navbar,
  Page,
} from 'konsta/react'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import PickerSheet, { type PickerOption } from '../sheets/PickerSheet'
import Sheet from '../components/Sheet'
import TabPill from '../components/TabPill'

// Что умеем заказывать агенту. Сама генерация — его работа: доска только
// принимает заказ и кладёт его задачей в проект.
interface Kind {
  id: string
  label: string
  hint: string
  placeholder: string
  color: string
  Icon: LucideIcon
}

const KINDS: Kind[] = [
  {
    id: 'photo',
    label: 'Создать фото',
    hint: 'Картинка по описанию',
    placeholder: 'Опиши кадр: что, где, в каком стиле',
    color: '#4ea3ff',
    Icon: ImageIcon,
  },
  {
    id: 'video',
    label: 'Создать видео',
    hint: 'Ролик по сценарию',
    placeholder: 'О чём ролик, сколько секунд, с озвучкой или без',
    color: '#bf5af2',
    Icon: Video,
  },
  {
    id: 'post',
    label: 'Создать пост',
    hint: 'Текст для канала',
    placeholder: 'Тема, для кого, какой длины',
    color: '#30d158',
    Icon: FileText,
  },
  {
    id: 'audio',
    label: 'Создать аудио',
    hint: 'Озвучка или музыка',
    placeholder: 'Текст для озвучки или описание музыки',
    color: '#ff9f0a',
    Icon: AudioLines,
  },
]

export default function GeneratePage() {
  const nav = useNavigate()
  const { state, refresh } = useApp()

  const [kind, setKind] = useState<Kind | null>(null)
  const [order, setOrder] = useState('')
  const [goal, setGoal] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const project =
    state?.projects.find((p) => p.id === projectId) ?? state?.projects[0] ?? null

  const options: PickerOption[] = useMemo(
    () => state?.projects.map((p) => ({ id: p.id, label: p.name })) ?? [],
    [state?.projects],
  )

  // заказ уходит задачей: агент увидит её в своём проходе и сделает
  const order_ = async () => {
    if (!kind || !order.trim() || !project || busy) return
    setBusy(true)
    try {
      const first = order.trim().split('\n')[0].slice(0, 60)
      await api.addTask({
        title: `${kind.label}: ${first}`,
        note: order.trim(),
        project: project.id,
        flagged: true,
      })
      haptic('success')
      setKind(null)
      setOrder('')
      await refresh()
      nav(`/project/${project.id}`)
    } finally {
      setBusy(false)
    }
  }

  const split = async () => {
    if (!goal.trim() || !project || busy) return
    setBusy(true)
    try {
      const out = await api.addGoal(goal.trim(), project.id)
      haptic('success')
      setGoal('')
      await refresh()
      if (out?.project) nav(`/project/${out.project}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <Navbar title="Генерация" large transparent />

      <List strong inset dividers>
        {KINDS.map((k) => (
          <ListItem
            key={k.id}
            link
            title={k.label}
            subtitle={k.hint}
            onClick={() => {
              haptic('light')
              setOrder('')
              setKind(k)
            }}
            media={
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${k.color}22`, color: k.color }}
              >
                <k.Icon size={20} strokeWidth={1.8} />
              </span>
            }
          />
        ))}
      </List>
      <BlockFooter inset className="!text-[13px]">
        Заказ ложится задачей в проект — агент возьмёт её в ближайший проход
        и принесёт результат в отчёте.
      </BlockFooter>

      <BlockTitle>Или целью словами</BlockTitle>
      <Block strong inset>
        <textarea
          rows={5}
          placeholder="Например: провести турнир на 100 игроков со входом 10 звёзд, к пятнице"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
        />
      </Block>
      <BlockFooter inset className="!text-[13px]">
        Агент сам разложит цель на задачи и заведёт этап.
      </BlockFooter>

      <List strong inset>
        <ListItem
          link
          title="Проект"
          after={project ? project.name : 'нет проектов'}
          onClick={() => setPicking(true)}
        />
      </List>

      <Block>
        <Button large rounded disabled={!goal.trim() || !project || busy} onClick={split}>
          <Sparkles size={18} className="mr-2" />
          {busy ? 'Раскладываю…' : 'Разложить на задачи'}
        </Button>
      </Block>

      <PickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        title="В какой проект"
        allowClear={false}
        options={options}
        value={project?.id ?? null}
        onPick={(id) => setProjectId(id)}
      />

      <Sheet
        open={!!kind}
        onClose={() => setKind(null)}
        title={kind?.label ?? ''}
      >
        <Block strong inset className="!mt-0">
          <textarea
            rows={5}
            autoFocus
            placeholder={kind?.placeholder}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
          />
        </Block>
        <List strong inset>
          <ListItem
            link
            title="Проект"
            after={project ? project.name : 'нет проектов'}
            onClick={() => setPicking(true)}
          />
        </List>
        <Block>
          <Button large rounded disabled={!order.trim() || !project || busy} onClick={order_}>
            {busy ? 'Отправляю…' : 'Поручить агенту'}
          </Button>
        </Block>
      </Sheet>

      <TabPill />
    </Page>
  )
}
