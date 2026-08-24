import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
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
import TabPill from '../components/TabPill'

// Второй экран: пишешь словами, что нужно получить, и агент сам режет это
// на задачи. Никаких полей и статусов — разбор его работа.
export default function GeneratePage() {
  const nav = useNavigate()
  const { state, refresh } = useApp()

  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const project =
    state?.projects.find((p) => p.id === projectId) ?? state?.projects[0] ?? null

  const options: PickerOption[] = useMemo(
    () => state?.projects.map((p) => ({ id: p.id, label: p.name })) ?? [],
    [state?.projects],
  )

  const run = async () => {
    if (!text.trim() || !project || busy) return
    setBusy(true)
    try {
      const out = await api.addGoal(text.trim(), project.id)
      haptic('success')
      setText('')
      await refresh()
      if (out?.project) nav(`/project/${out.project}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <Navbar title="Генерация" large transparent />

      <BlockTitle>Что нужно получить</BlockTitle>
      <Block strong inset>
        <textarea
          rows={7}
          autoFocus
          placeholder="Например: провести турнир на 100 игроков со входом 10 звёзд, к пятнице"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full bg-transparent text-white text-[17px] outline-none resize-none placeholder:text-white/40"
        />
      </Block>
      <BlockFooter inset className="!text-[13px]">
        Пиши целью, а не задачами: агент сам разложит её на шаги, заведёт этап
        и возьмёт первую работу.
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
        <Button
          large
          rounded
          disabled={!text.trim() || !project || busy}
          onClick={run}
        >
          <Sparkles size={18} className="mr-2" />
          {busy ? 'Раскладываю…' : 'Сгенерировать задачи'}
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

      <TabPill />
    </Page>
  )
}
