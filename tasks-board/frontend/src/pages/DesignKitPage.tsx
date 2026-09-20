import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, Copy, Search } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Link as KLink,
  List,
  ListItem,
  Navbar,
  Page,
  Searchbar,
  Segmented,
  SegmentedButton,
} from 'konsta/react'
import blocks from '../lib/design-blocks.json'
import { DEMOS } from '../lib/design-demos'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'

interface Blok {
  id: string
  title: string
  group: string
  code: string
}

// Каталог блоков: живой пример плюс готовый код. Агент копирует кусок
// и собирает из них экран — ничего не выдумывая.
export default function DesignKitPage() {
  const navigate = useNavigate()
  const { state } = useApp()
  const vsechny = blocks as Blok[]
  // Правила берём у первого проекта, где они заданы: дизайн-код общий,
  // а правится в настройках конкретного проекта.
  const pravidla = state?.projects.find((p) => p.design)?.design ?? ''
  const projektSPravidly = state?.projects.find((p) => p.design)?.id
  const [pravidlaOtevrena, setPravidlaOtevrena] = useState(false)
  const [q, setQ] = useState('')
  const [skupina, setSkupina] = useState('все')
  const [zkopirovan, setZkopirovan] = useState<string | null>(null)

  const skupiny = useMemo(
    () => ['все', ...Array.from(new Set(vsechny.map((b) => b.group)))],
    [vsechny],
  )

  const nalezene = useMemo(() => {
    const dotaz = q.trim().toLowerCase()
    return vsechny.filter(
      (b) =>
        (skupina === 'все' || b.group === skupina) &&
        (!dotaz ||
          b.title.toLowerCase().includes(dotaz) ||
          b.id.includes(dotaz) ||
          b.code.toLowerCase().includes(dotaz)),
    )
  }, [vsechny, q, skupina])

  const kopirovat = async (b: Blok) => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(b.code)
      setZkopirovan(b.id)
      window.setTimeout(() => setZkopirovan(null), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Page className="pb-safe-10">
      <Navbar
        title="Блоки"
        subtitle={`${vsechny.length} готовых кусков`}
        left={
          <KLink onClick={() => navigate(-1)}>
            <ChevronLeft size={22} />
          </KLink>
        }
      />

      {pravidla && (
        <>
          <BlockTitle>Дизайн-код</BlockTitle>
          <List strong inset>
            <ListItem
              link
              onClick={() => setPravidlaOtevrena((p) => !p)}
              title="Правила: из чего собираем интерфейс"
              after={
                <ChevronDown
                  size={16}
                  className={`transition-transform ${pravidlaOtevrena ? 'rotate-180' : ''}`}
                />
              }
            />
            {pravidlaOtevrena && (
              <ListItem
                title={
                  <span className="block whitespace-pre-wrap text-[14px] font-normal leading-snug">
                    {pravidla}
                  </span>
                }
              />
            )}
            {projektSPravidly && (
              <ListItem
                link
                onClick={() => navigate(`/project/${projektSPravidly}/settings`)}
                title="Изменить правила"
                subtitle="в настройках проекта"
              />
            )}
          </List>
        </>
      )}

      <Searchbar
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onClear={() => setQ('')}
        placeholder="Найти блок"
      />

      <Block className="!mt-3 !mb-0 overflow-x-auto">
        <Segmented strong rounded className="!w-max min-w-full">
          {skupiny.map((g) => (
            <SegmentedButton
              key={g}
              active={skupina === g}
              onClick={() => setSkupina(g)}
              className="!text-[14px] whitespace-nowrap"
            >
              {g}
            </SegmentedButton>
          ))}
        </Segmented>
      </Block>

      {nalezene.length === 0 && (
        <List strong inset>
          <ListItem
            media={<Search size={20} />}
            title="Ничего не нашлось"
            subtitle="Попробуй другое слово"
          />
        </List>
      )}

      {nalezene.map((b) => {
        const Demo = DEMOS[b.id]
        return (
          <div key={b.id}>
            <BlockTitle>
              {b.title}
              <span className="ml-2 font-mono text-[12px] font-normal opacity-40">
                {b.id}
              </span>
            </BlockTitle>

            {Demo && (
              <div className="mx-safe-4 overflow-hidden rounded-3xl bg-ios-light-surface-2 py-2 dark:bg-ios-dark-surface-2">
                <Demo />
              </div>
            )}

            <div className="relative mx-safe-4 mt-2">
              <pre className="max-h-64 overflow-auto whitespace-pre rounded-2xl bg-ios-light-surface-1 p-3 pr-12 text-[12px] leading-snug text-black/80 dark:bg-ios-dark-surface-1 dark:text-white/80">
                {b.code}
              </pre>
              <button
                type="button"
                onClick={() => kopirovat(b)}
                aria-label={`Скопировать ${b.title}`}
                className="absolute right-2 top-2 rounded-full bg-black/10 p-2 text-black/70 active:opacity-60 dark:bg-white/10 dark:text-white/70"
              >
                {zkopirovan === b.id ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </div>
        )
      })}
    </Page>
  )
}
