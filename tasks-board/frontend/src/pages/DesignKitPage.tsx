import { useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  FormInput,
  LayoutGrid,
  ListTree,
  MessageCircle,
  MousePointerClick,
  PanelsTopLeft,
  Search,
  Shapes,
} from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
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
import { haptic } from '../lib/telegram'
import Popup from '../components/Popup'

interface Blok {
  id: string
  title: string
  group: string
  code: string
}

const GROUP_META: Record<
  string,
  { icon: ComponentType<{ size?: number; className?: string }>; color: string; bg: string }
> = {
  Списки: { icon: ListTree, color: 'text-[#007aff]', bg: 'bg-[#007aff]/12' },
  Формы: { icon: FormInput, color: 'text-[#af52de]', bg: 'bg-[#af52de]/12' },
  Управление: { icon: MousePointerClick, color: 'text-[#ff9500]', bg: 'bg-[#ff9500]/12' },
  'Показ данных': { icon: LayoutGrid, color: 'text-[#34c759]', bg: 'bg-[#34c759]/12' },
  Навигация: { icon: PanelsTopLeft, color: 'text-[#5856d6]', bg: 'bg-[#5856d6]/12' },
  Окна: { icon: Shapes, color: 'text-[#ff2d55]', bg: 'bg-[#ff2d55]/12' },
  Чат: { icon: MessageCircle, color: 'text-[#00a7a5]', bg: 'bg-[#00a7a5]/12' },
}

const fallbackMeta = GROUP_META['Показ данных']

// Каталог устроен как библиотека, а не длинная техническая простыня:
// компактные плитки открывают живой пример и код в отдельном окне.
export default function DesignKitPage() {
  const navigate = useNavigate()
  const { state } = useApp()
  const vsechny = blocks as Blok[]
  const pravidla = state?.projects.find((p) => p.design)?.design ?? ''
  const projektSPravidly = state?.projects.find((p) => p.design)?.id
  const [pravidlaOtevrena, setPravidlaOtevrena] = useState(false)
  const [q, setQ] = useState('')
  const [skupina, setSkupina] = useState('Все')
  const [vybrany, setVybrany] = useState<Blok | null>(null)
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
    nalezene.forEach((blok) => map.set(blok.group, [...(map.get(blok.group) ?? []), blok]))
    return Array.from(map.entries())
  }, [nalezene])

  const kopirovat = async (b: Blok) => {
    try {
      await navigator.clipboard.writeText(b.code)
      haptic('success')
      setZkopirovan(b.id)
      window.setTimeout(() => setZkopirovan(null), 1500)
    } catch {
      haptic('error')
    }
  }

  const Demo = vybrany ? DEMOS[vybrany.id] : null
  const activeMeta = vybrany ? GROUP_META[vybrany.group] ?? fallbackMeta : fallbackMeta
  const ActiveIcon = activeMeta.icon

  return (
    <Page className="pb-safe-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Каталог блоков"
        subtitle="Framework7 · iOS"
        left={
          <KLink iconOnly onClick={() => navigate(-1)} aria-label="Назад">
            <ChevronLeft size={24} />
          </KLink>
        }
      />

      <div className="mx-safe-4 mt-4 overflow-hidden rounded-[26px] bg-gradient-to-br from-[#087cff] to-[#6155e8] p-5 text-white shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">
              UI kit проекта
            </div>
            <div className="mt-1 text-[26px] font-bold tracking-[-0.03em]">
              Собирай, не рисуй заново
            </div>
          </div>
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
            <Shapes size={26} />
          </div>
        </div>
        <div className="mt-4 flex gap-2 text-[13px] font-medium">
          <span className="rounded-full bg-white/15 px-3 py-1.5">{vsechny.length} блоков</span>
          <span className="rounded-full bg-white/15 px-3 py-1.5">{skupiny.length - 1} разделов</span>
        </div>
      </div>

      {pravidla && (
        <List strong inset className="!mt-3">
          <ListItem
            link
            onClick={() => setPravidlaOtevrena((open) => !open)}
            title="Правила дизайн-кода"
            subtitle="Единый стиль для генерации страниц"
            chevronIcon={
              <ChevronDown
                size={17}
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-black/35 transition-transform dark:text-white/35 ${pravidlaOtevrena ? 'rotate-180' : ''}`}
              />
            }
            innerClassName="pr-9"
          />
          {pravidlaOtevrena && (
            <ListItem
              title={
                <span className="block whitespace-pre-wrap py-1 text-[14px] font-normal leading-relaxed text-black/65 dark:text-white/65">
                  {pravidla}
                </span>
              }
            />
          )}
          {pravidlaOtevrena && projektSPravidly && (
            <ListItem
              link
              onClick={() => navigate(`/project/${projektSPravidly}/settings`)}
              title="Изменить правила"
            />
          )}
        </List>
      )}

      <div className="sticky top-0 z-10 mt-3 border-y border-black/[.05] bg-ios-light-surface/90 py-2 backdrop-blur-xl dark:border-white/[.06] dark:bg-ios-dark-surface/90">
        <Searchbar
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onClear={() => setQ('')}
          placeholder="Найти блок"
        />
        <div className="mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {skupiny.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => {
                haptic('light')
                setSkupina(group)
              }}
              className={`min-h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors ${
                skupina === group
                  ? 'bg-primary text-white'
                  : 'bg-black/[.06] text-black/70 dark:bg-white/10 dark:text-white/75'
              }`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {nalezene.length === 0 && (
        <List strong inset>
          <ListItem
            media={<Search size={20} />}
            title="Ничего не нашлось"
            subtitle="Попробуй другое слово или выбери все разделы"
          />
        </List>
      )}

      {poSkupinach.map(([group, groupBlocks]) => {
        const meta = GROUP_META[group] ?? fallbackMeta
        const Icon = meta.icon
        return (
          <section key={group}>
            <BlockTitle className="flex items-center justify-between">
              <span>{group}</span>
              <span className="text-[12px] font-medium opacity-45">{groupBlocks.length}</span>
            </BlockTitle>
            <div className="mx-safe-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {groupBlocks.map((blok) => (
                <button
                  key={blok.id}
                  type="button"
                  onClick={() => {
                    haptic('light')
                    setVybrany(blok)
                  }}
                  className="min-h-[126px] rounded-[22px] bg-ios-light-surface-1 p-4 text-left shadow-[0_1px_0_rgba(0,0,0,.04)] transition-transform active:scale-[.98] dark:bg-ios-dark-surface-1"
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-2xl ${meta.bg} ${meta.color}`}>
                    <Icon size={21} />
                  </span>
                  <span className="mt-4 block text-[15px] font-semibold leading-tight text-black dark:text-white">
                    {blok.title}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-black/35 dark:text-white/35">
                    {blok.id}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      <Popup
        open={vybrany !== null}
        onClose={() => setVybrany(null)}
        title={vybrany?.title ?? 'Блок'}
        pageClassName="pb-safe-10"
        headerRight={
          vybrany ? (
            <KLink iconOnly onClick={() => kopirovat(vybrany)} aria-label="Скопировать код">
              {zkopirovan === vybrany.id ? <Check size={22} /> : <Copy size={21} />}
            </KLink>
          ) : null
        }
      >
        {vybrany && (
          <>
            <div className="mx-safe-4 mt-4 flex items-center gap-3 rounded-2xl bg-ios-light-surface-1 p-3 dark:bg-ios-dark-surface-1">
              <span className={`grid h-11 w-11 place-items-center rounded-2xl ${activeMeta.bg} ${activeMeta.color}`}>
                <ActiveIcon size={23} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold">{vybrany.title}</div>
                <div className="text-[13px] text-black/45 dark:text-white/45">
                  {vybrany.group} · Framework7 iOS
                </div>
              </div>
            </div>

            <BlockTitle>Живой пример</BlockTitle>
            <div className="mx-safe-4 min-h-24 overflow-hidden rounded-[24px] border border-black/[.05] bg-ios-light-surface-2 py-3 dark:border-white/[.07] dark:bg-ios-dark-surface-2">
              {Demo ? <Demo /> : <Block>Для блока доступен готовый код.</Block>}
            </div>

            <BlockTitle>Код блока</BlockTitle>
            <div className="relative mx-safe-4 overflow-hidden rounded-[20px] bg-[#17171a]">
              <pre className="max-h-[42vh] overflow-auto whitespace-pre p-4 pr-12 text-[12px] leading-relaxed text-white/85">
                {vybrany.code}
              </pre>
              <button
                type="button"
                onClick={() => kopirovat(vybrany)}
                aria-label={`Скопировать ${vybrany.title}`}
                className="absolute right-2.5 top-2.5 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:opacity-60"
              >
                {zkopirovan === vybrany.id ? <Check size={17} /> : <Copy size={17} />}
              </button>
            </div>

            <Block className="!mb-8">
              <Button large rounded onClick={() => kopirovat(vybrany)}>
                {zkopirovan === vybrany.id ? 'Код скопирован' : 'Скопировать код'}
              </Button>
            </Block>
          </>
        )}
      </Popup>
    </Page>
  )
}
