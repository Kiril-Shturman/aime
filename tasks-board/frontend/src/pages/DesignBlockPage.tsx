import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronLeft, Copy, Moon, Sun } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  Link as KLink,
  List,
  ListItem,
  Navbar,
  Page,
} from 'konsta/react'
import blocks from '../lib/design-blocks.json'
import { DEMOS } from '../lib/design-demos'
import { useTheme } from '../store/ThemeStore'
import { haptic } from '../lib/telegram'

interface Blok {
  id: string
  title: string
  group: string
  code: string
}

// Отдельная страница блока: пример занимает весь экран, рядом код и
// переключатель темы — так видно, как блок живёт и в светлой, и в тёмной.
export default function DesignBlockPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [zkopirovan, setZkopirovan] = useState(false)

  const blok = (blocks as Blok[]).find((b) => b.id === id) ?? null
  const Demo = blok ? DEMOS[blok.id] : null

  if (!blok) {
    return (
      <Page>
        <Navbar
          title="Блок"
          left={
            <KLink iconOnly onClick={() => navigate('/design')} aria-label="Назад">
              <ChevronLeft size={24} />
            </KLink>
          }
        />
        <Block>Такого блока нет.</Block>
      </Page>
    )
  }

  const kopirovat = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(blok.code)
      setZkopirovan(true)
      window.setTimeout(() => setZkopirovan(false), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Page className="pb-safe-10">
      <Navbar
        className="!bg-ios-light-surface dark:!bg-ios-dark-surface [&>div[class*=backdrop-blur]]:!hidden"
        colors={{ bgIos: 'bg-ios-light-surface dark:bg-ios-dark-surface' }}
        title={blok.title}
        subtitle={`${blok.group} · ${blok.id}`}
        left={
          <KLink iconOnly onClick={() => navigate('/design')} aria-label="Назад">
            <ChevronLeft size={24} />
          </KLink>
        }
        right={
          <KLink
            iconOnly
            onClick={() => {
              haptic('light')
              toggle()
            }}
            aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </KLink>
        }
      />

      <div className="mt-2 [&_.k-list]:!mx-0 [&>.block]:!mx-0 px-safe-4">
        {Demo ? <Demo /> : <Block>Пример — в коде ниже.</Block>}
      </div>

      <BlockTitle>Код</BlockTitle>
      <List strong inset>
        <ListItem
          title={
            <pre className="block max-h-[50dvh] overflow-auto whitespace-pre py-1 font-mono text-[12px] font-normal leading-snug text-black/75 dark:text-white/75">
              {blok.code}
            </pre>
          }
        />
      </List>
      <Block className="grid gap-2">
        <Button large rounded onClick={kopirovat}>
          {zkopirovan ? <Check size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
          {zkopirovan ? 'Код скопирован' : 'Скопировать код'}
        </Button>
        <Button large rounded clear onClick={() => navigate('/design')}>
          Ко всем блокам
        </Button>
      </Block>
      <BlockFooter>
        Тот же кусок агент берёт командой board_blocks id={blok.id}.
      </BlockFooter>
    </Page>
  )
}
