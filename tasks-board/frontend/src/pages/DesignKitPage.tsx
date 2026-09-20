import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, Copy, Maximize2, Moon, Sun } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  Chip,
  Link as KLink,
  List,
  ListItem,
  Navbar,
  Page,
  Searchbar,
} from 'konsta/react'
import blocks from '../lib/design-blocks.json'
import { DEMOS } from '../lib/design-demos'
import { useApp } from '../store/AppStore'
import { useTheme } from '../store/ThemeStore'
import { haptic } from '../lib/telegram'

// этим блокам мало места в ленте — показываем их отдельной страницей
const NA_STRANKU = new Set([
  // всё, что вылезает поверх экрана, показываем на своей странице —
  // там оно живёт как в настоящем приложении, с затемнением и анимацией
  'popup',
  'sheet-modal',
  'actions',
  'dialog',
  'popover',
  'panel',
  'toast',
  'notification',
  'photo-browser',
  'smart-select',
  'tooltip',
  // и то, чему просто мало места в ленте
  'calendar',
  'virtual-list',
  'messages',
  'messagebar',
  'login-screen',
  'picker',
  'infinite-scroll',
  'list-index',
  'swiper',
  'tabbar',
  'navbar',
  'subnavbar',
  'statusbar',
])

const OKNA = new Set([
  'popup', 'sheet-modal', 'actions', 'dialog', 'popover', 'panel', 'toast',
  'notification', 'photo-browser', 'smart-select', 'tooltip',
])

interface Blok {
  id: string
  title: string
  group: string
  code: string
}

// Каталог собран из тех же компонентов, что и вся доска: Navbar, List,
// Block, Chip. Блоки показаны сразу живьём — по ним можно тыкать, а код
// раскрывается под примером.
export default function DesignKitPage() {
  const navigate = useNavigate()
  const { state } = useApp()
  const { theme, toggle } = useTheme()
  const vsechny = blocks as Blok[]
  const pravidla = state?.projects.find((p) => p.design)?.design ?? ''
  const projektSPravidly = state?.projects.find((p) => p.design)?.id

  const [q, setQ] = useState('')
  const [skupina, setSkupina] = useState('Все')
  const [pravidlaOtevrena, setPravidlaOtevrena] = useState(false)
  const [kod, setKod] = useState<string | null>(null)
  const [zkopirovan, setZkopirovan] = useState<string | null>(null)

  const skupiny = useMemo(
    () => ['Все', ...Array.from(new Set(vsechny.map((b) => b.group)))],
    [vsechny],
  )

  const nalezene = useMemo(() => {
    const dotaz = q.trim().toLowerCase()
    return vsechny.filter(
      (b) =>
        (skupina === 'Все' || b.group === skupina) &&
        (!dotaz ||
          b.title.toLowerCase().includes(dotaz) ||
          b.group.toLowerCase().includes(dotaz) ||
          b.id.includes(dotaz) ||
          b.code.toLowerCase().includes(dotaz)),
    )
  }, [vsechny, q, skupina])

  const poSkupinach = useMemo(() => {
    const map = new Map<string, Blok[]>()
    nalezene.forEach((b) => map.set(b.group, [...(map.get(b.group) ?? []), b]))
    return Array.from(map.entries())
  }, [nalezene])

  const kopirovat = async (b: Blok) => {
    try {
      await navigator.clipboard.writeText(b.code)
      haptic('success')
      setZkopirovan(b.id)
      window.setTimeout(() => setZkopirovan(null), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Page className="pb-safe-12">
      <Navbar
        className="!bg-ios-light-surface dark:!bg-ios-dark-surface [&>div[class*=backdrop-blur]]:!hidden"
        // у konsta шапка по умолчанию полупрозрачная: под неё уезжает
        // содержимое и читается сквозь. Здесь делаем её плотной.
        colors={{ bgIos: 'bg-ios-light-surface dark:bg-ios-dark-surface' }}
        title="Блоки"
        subtitle={`${vsechny.length} готовых кусков · framework7 iOS`}
        left={
          <KLink iconOnly onClick={() => navigate(-1)} aria-label="Назад">
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

      {pravidla && (
        <>
          <BlockTitle>Дизайн-код</BlockTitle>
          <List strong inset>
            <ListItem
              link
              onClick={() => setPravidlaOtevrena((o) => !o)}
              title="Правила: из чего собираем интерфейс"
              chevronIcon={
                <ChevronDown
                  size={17}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-black/35 transition-transform dark:text-white/35 ${
                    pravidlaOtevrena ? 'rotate-180' : ''
                  }`}
                />
              }
              innerClassName="pr-9"
            />
            {pravidlaOtevrena && (
              <ListItem
                title={
                  <span className="block whitespace-pre-wrap py-1 text-[14px] font-normal leading-relaxed text-black/70 dark:text-white/65">
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

      <Block className="!my-2 flex flex-wrap gap-1.5">
        {skupiny.map((g) => (
          <Chip
            key={g}
            onClick={() => {
              haptic('light')
              setSkupina(g)
            }}
            className={`!m-0 shrink-0 cursor-pointer ${
              skupina === g ? '!bg-primary !text-white' : ''
            }`}
          >
            {g}
          </Chip>
        ))}
      </Block>

      {nalezene.length === 0 && (
        <List strong inset>
          <ListItem
            title="Ничего не нашлось"
            subtitle="Попробуй другое слово или выбери «Все»"
          />
        </List>
      )}

      {poSkupinach.map(([group, groupBlocks]) => (
        <div key={group}>
          <div className="mx-safe-4 mb-1 mt-7 flex items-baseline justify-between">
            <h2 className="text-[22px] font-bold tracking-tight text-black dark:text-white">
              {group}
            </h2>
            <span className="text-[13px] text-black/40 dark:text-white/35">
              {groupBlocks.length}
            </span>
          </div>

          {groupBlocks.map((b) => {
            const Demo = DEMOS[b.id]
            const otevreny = kod === b.id
            return (
              <div key={b.id} className="mb-4">
                <BlockTitle className="!mb-1 flex items-center justify-between">
                  <span>{b.title}</span>
                  <span className="font-mono text-[11px] font-normal opacity-40">
                    {b.id}
                  </span>
                </BlockTitle>

                {/* Живой пример. Элементы с собственными отступами
                    (inset-списки, Block) оставляем как есть, а те, что
                    идут во всю ширину, поджимаем такими же полями. */}
                {NA_STRANKU.has(b.id) ? (
                  <List strong inset className="!mt-1 !mb-0">
                    <ListItem
                      link
                      onClick={() => navigate(`/design/${b.id}`)}
                      media={<Maximize2 size={20} className="text-primary" />}
                      title="Открыть на отдельной странице"
                      subtitle={
                        OKNA.has(b.id)
                          ? 'окно показывается поверх экрана'
                          : 'блоку нужен весь экран'
                      }
                    />
                  </List>
                ) : (
                  <div className="mt-1 px-safe-4 [&_.k-list]:!mx-0 [&_.k-list]:!my-0 [&>.block]:!mx-0">
                    {Demo ? <Demo /> : <Block>Пример — в коде ниже.</Block>}
                  </div>
                )}

                <List strong inset className="!mt-2 !mb-0">
                  <ListItem
                    link
                    onClick={() => navigate(`/design/${b.id}`)}
                    title="Во весь экран"
                    after={<Maximize2 size={17} className="text-primary" />}
                  />
                  <ListItem
                    link
                    onClick={() => setKod(otevreny ? null : b.id)}
                    title={otevreny ? 'Скрыть код' : 'Показать код'}
                    after={
                      <KLink
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation()
                          kopirovat(b)
                        }}
                        aria-label={`Скопировать ${b.title}`}
                      >
                        {zkopirovan === b.id ? <Check size={18} /> : <Copy size={18} />}
                      </KLink>
                    }
                  />
                  {otevreny && (
                    <ListItem
                      title={
                        <pre className="block max-h-72 overflow-auto whitespace-pre py-1 font-mono text-[12px] font-normal leading-snug text-black/75 dark:text-white/75">
                          {b.code}
                        </pre>
                      }
                    />
                  )}
                </List>
              </div>
            )
          })}
        </div>
      ))}

      <Block className="!mt-6">
        <Button large rounded clear onClick={() => navigate(-1)}>
          Назад
        </Button>
      </Block>
      <BlockFooter>
        Агент берёт те же куски командой board_blocks — список, board_blocks
        id=&lt;id&gt; — код.
      </BlockFooter>
    </Page>
  )
}
