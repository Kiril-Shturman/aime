import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  Badge,
  Block,
  BlockFooter,
  BlockHeader,
  BlockTitle,
  Breadcrumbs,
  BreadcrumbsItem,
  BreadcrumbsSeparator,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogButton,
  Fab,
  Link as KLink,
  List,
  ListButton,
  ListInput,
  ListItem,
  MenuList,
  MenuListItem,
  Message,
  Messagebar,
  Messages,
  MessagesTitle,
  Navbar,
  NavbarBackLink,
  Page,
  Panel,
  Notification,
  Popover,
  Preloader,
  Progressbar,
  Radio,
  Range,
  Searchbar,
  Segmented,
  SegmentedButton,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabbar,
  TabbarLink,
  Toast,
  Toggle,
  Toolbar,
  ToolbarPane,
} from 'konsta/react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  HelpCircle,
  MoreHorizontal,
  Plus,
  Send,
  User,
  X,
} from 'lucide-react'
import PhotoBrowser from '../components/PhotoBrowser'
import Popup from '../components/Popup'
import Sheet from '../components/Sheet'
import Pill from '../components/Pill'
import { haptic } from '../lib/telegram'
import '../f7-timeline.css'

// Живые примеры блоков. Рядом с каждым в каталоге лежит его код —
// агент копирует кусок и собирает из таких кирпичей экран.
const ucastnik = { id: 'demo', name: 'Разраб', kind: 'agent' as const }

function Vrstva({ children }: { children: React.ReactNode }) {
  return createPortal(<>{children}</>, document.body)
}

function Okno({
  label,
  children,
}: {
  label: string
  children: (open: boolean, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button rounded onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Vrstva>{children(open, () => setOpen(false))}</Vrstva>
    </>
  )
}

export const DEMOS: Record<string, () => React.ReactNode> = {
  list: () => (
    <List strong inset>
      <ListItem title="Первый пункт" />
      <ListItem title="Второй пункт" subtitle="Подпись под названием" />
      <ListItem link onClick={() => {}} title="Пункт-ссылка" after="значение" />
    </List>
  ),
  'list-media': function ListMediaDemo() {
    const [vybrany, setVybrany] = useState<string | null>(null)
    const lide = [
      { id: 'r', name: 'Разраб', role: 'пишет код', pill: 'берёт задачи', tone: 'bot' },
      { id: 'n', name: 'NightWorkrr', role: 'проверяет', pill: 'новых не берёт', tone: 'free' },
    ]
    return (
      <List strong inset dividers>
        {lide.map((m) => (
          <ListItem
            key={m.id}
            link
            onClick={() => setVybrany(vybrany === m.id ? null : m.id)}
            media={
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 font-semibold text-primary">
                {m.name[0]}
              </span>
            }
            title={m.name}
            subtitle={vybrany === m.id ? 'выбран' : m.role}
            after={<Pill tone={m.tone}>{m.pill}</Pill>}
          />
        ))}
      </List>
    )
  },

  'list-group': function ListGroupDemo() {
    const [kdo, setKdo] = useState('Алексей')
    return (
      <List strong inset>
        {[
          ['А', ['Алексей', 'Анна']],
          ['Б', ['Борис']],
        ].map(([pismeno, jmena]) => (
          <div key={pismeno as string}>
            <ListItem title={pismeno as string} groupTitle />
            {(jmena as string[]).map((j) => (
              <ListItem
                key={j}
                link
                title={j}
                onClick={() => setKdo(j)}
                after={kdo === j ? <Check size={18} className="text-primary" /> : undefined}
              />
            ))}
          </div>
        ))}
      </List>
    )
  },

  'list-button': () => (
    <List strong inset>
      <ListButton onClick={() => {}}>Обычное действие</ListButton>
      <ListButton
        colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }}
        onClick={() => {}}
      >
        Опасное действие
      </ListButton>
    </List>
  ),
  'menu-list': () => (
    <MenuList>
      <MenuListItem active title="Сегодня" />
      <MenuListItem title="Запланировано" />
      <MenuListItem title="Все задачи" />
    </MenuList>
  ),
  inputs: function Inputs() {
    const [name, setName] = useState('')
    const [note, setNote] = useState('')
    return (
      <List strong inset>
        <ListInput
          label="Имя"
          type="text"
          placeholder="Как зовут"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Заметка"
          type="textarea"
          placeholder="Пара строк"
          value={note}
          onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
      </List>
    )
  },
  checkbox: function Checkboxes() {
    const [on, setOn] = useState(true)
    return (
      <List strong inset>
        <ListItem
          label
          title="Пункт с галочкой"
          media={
            <Checkbox component="div" checked={on} onChange={() => setOn(!on)} />
          }
        />
      </List>
    )
  },
  radio: function Radios() {
    const [value, setValue] = useState('work')
    return (
      <List strong inset>
        {[
          { id: 'work', label: 'Исполнитель' },
          { id: 'check', label: 'Проверяющий' },
        ].map((o) => (
          <ListItem
            key={o.id}
            label
            title={o.label}
            media={
              <Radio
                component="div"
                checked={value === o.id}
                onChange={() => setValue(o.id)}
              />
            }
          />
        ))}
      </List>
    )
  },
  toggle: function Toggles() {
    const [on, setOn] = useState(true)
    return (
      <List strong inset>
        <ListItem
          label
          title="Берёт новые задачи"
          after={
            <Toggle component="div" checked={on} onChange={() => setOn(!on)} />
          }
        />
      </List>
    )
  },
  stepper: function Steppers() {
    const [count, setCount] = useState(3)
    return (
      <Block className="!my-0">
        <Stepper
          value={count}
          onPlus={() => setCount(count + 1)}
          onMinus={() => setCount(Math.max(0, count - 1))}
        />
      </Block>
    )
  },
  range: function Ranges() {
    const [value, setValue] = useState(40)
    return (
      <Block className="!my-0">
        <Range
          value={value}
          step={1}
          min={0}
          max={100}
          onChange={(e) => setValue(Number((e.target as HTMLInputElement).value))}
        />
      </Block>
    )
  },
  searchbar: function Searchbars() {
    const [q, setQ] = useState('')
    return (
      <Searchbar
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onClear={() => setQ('')}
        placeholder="Найти задачу"
      />
    )
  },
  segmented: function Segments() {
    const [tab, setTab] = useState('a')
    return (
      <Block className="!my-0">
        <Segmented strong rounded>
          <SegmentedButton active={tab === 'a'} onClick={() => setTab('a')}>
            Исполнитель
          </SegmentedButton>
          <SegmentedButton active={tab === 'b'} onClick={() => setTab('b')}>
            Проверяющий
          </SegmentedButton>
        </Segmented>
      </Block>
    )
  },
  buttons: () => (
    <Block className="!my-0 grid gap-2">
      <Button large rounded onClick={() => {}}>
        Основная
      </Button>
      <Button large rounded outline onClick={() => {}}>
        Контурная
      </Button>
      <Button large rounded clear onClick={() => {}}>
        Без фона
      </Button>
    </Block>
  ),
  fab: function FabDemo() {
    const [open, setOpen] = useState(false)
    return (
      <Block className="!my-0">
        <div className="relative flex h-40 items-end justify-end rounded-3xl bg-ios-light-surface-1 p-4 dark:bg-ios-dark-surface-1">
          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
            {['Задача', 'Этап', 'Участник'].map((label, i) => (
              <span
                key={label}
                className="flex items-center gap-2 transition-all duration-200"
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? 'translateY(0)' : `translateY(${(3 - i) * 12}px)`,
                  transitionDelay: `${open ? i * 45 : 0}ms`,
                  pointerEvents: open ? 'auto' : 'none',
                }}
              >
                <span className="rounded-lg bg-black/70 px-2 py-1 text-[12px] text-white dark:bg-white/85 dark:text-black">
                  {label}
                </span>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
                  <Plus size={18} />
                </span>
              </span>
            ))}
            <Fab
              className="!static"
              icon={
                <Plus
                  size={22}
                  className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`}
                />
              }
              onClick={() => setOpen((o) => !o)}
            />
          </div>
        </div>
        <Button rounded small className="mt-2" onClick={() => setOpen((o) => !o)}>
          {open ? 'Свернуть' : 'Запустить анимацию'}
        </Button>
      </Block>
    )
  },

  chips: () => (
    <Block className="!my-0 flex flex-wrap gap-1.5">
      <Chip>Просто чип</Chip>
      <Chip
        media={
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">
            Р
          </span>
        }
      >
        взял: Разраб
      </Chip>
      <Chip deleteButton onDelete={() => {}}>
        С крестиком
      </Chip>
    </Block>
  ),
  badge: function BadgeDemo() {
    const [kolik, setKolik] = useState(7)
    return (
      <List strong inset>
        <ListItem
          link
          onClick={() => setKolik((k) => (k > 20 ? 1 : k + 3))}
          title="Непрочитанные"
          after={<Badge>{kolik}</Badge>}
        />
        <ListItem link onClick={() => setKolik(0)} title="Прочитать всё" after={<Badge colors={{ bg: 'bg-black/20 dark:bg-white/20' }}>0</Badge>} />
      </List>
    )
  },

  card: function CardDemo() {
    const [rozbaleno, setRozbaleno] = useState(false)
    return (
      <Card
        header="Заголовок карточки"
        footer={
          <KLink onClick={() => setRozbaleno((r) => !r)}>
            {rozbaleno ? 'Свернуть' : 'Читать дальше'}
          </KLink>
        }
      >
        Содержимое карточки: текст, список, что угодно.
        {rozbaleno && (
          <span className="mt-2 block opacity-70">
            Развёрнутая часть — тут может быть длинное описание, картинка или
            таблица.
          </span>
        )}
      </Card>
    )
  },

  progressbar: function ProgressDemo() {
    const [p, setP] = useState(0.45)
    const bezi = useRef<number | null>(null)
    const spustit = () => {
      if (bezi.current) window.clearInterval(bezi.current)
      setP(0)
      bezi.current = window.setInterval(() => {
        setP((x) => {
          if (x >= 1) {
            if (bezi.current) window.clearInterval(bezi.current)
            return 1
          }
          return x + 0.05
        })
      }, 120)
    }
    return (
      <Block className="!my-0 grid gap-3">
        <Progressbar progress={p} />
        <span className="flex items-center gap-2">
          <Button rounded small onClick={spustit}>
            Запустить
          </Button>
          <Button rounded small clear onClick={() => setP((x) => Math.min(1, x + 0.15))}>
            +15%
          </Button>
          <span className="ml-auto text-[13px] tabular-nums opacity-60">
            {Math.round(p * 100)}%
          </span>
        </span>
      </Block>
    )
  },

  preloader: function PreloaderDemo() {
    const [velke, setVelke] = useState(false)
    return (
      <Block className="!my-0 flex flex-col items-center gap-3">
        <Preloader className={velke ? 'h-10 w-10' : 'h-6 w-6'} />
        <Button rounded small onClick={() => setVelke((v) => !v)}>
          {velke ? 'Поменьше' : 'Побольше'}
        </Button>
      </Block>
    )
  },

  table: function TableDemo() {
    const [razeni, setRazeni] = useState<'title' | 'status'>('title')
    const radky = [
      { title: 'Сверстать главную', status: 'В работе' },
      { title: 'Прикрутить кассу', status: 'Не начата' },
      { title: 'Починить чат', status: 'Готово' },
    ]
    const serazene = [...radky].sort((a, b) => a[razeni].localeCompare(b[razeni]))
    return (
      <Table>
        <TableHead>
          <TableRow header>
            <TableCell header>
              <button type="button" onClick={() => setRazeni('title')} className={razeni === 'title' ? 'text-primary' : ''}>
                Задача
              </button>
            </TableCell>
            <TableCell header>
              <button type="button" onClick={() => setRazeni('status')} className={razeni === 'status' ? 'text-primary' : ''}>
                Статус
              </button>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {serazene.map((r) => (
            <TableRow key={r.title}>
              <TableCell>{r.title}</TableCell>
              <TableCell>{r.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  },

  breadcrumbs: function BreadcrumbsDemo() {
    const cesta = ['Проект', 'Модуль', 'Этап']
    const [kde, setKde] = useState(2)
    return (
      <Block className="!my-0">
        <Breadcrumbs>
          {cesta.slice(0, kde + 1).map((c, i) => (
            <span key={c} className="flex items-center">
              {i > 0 && <BreadcrumbsSeparator />}
              <BreadcrumbsItem active={i === kde} onClick={() => setKde(i)}>
                {c}
              </BreadcrumbsItem>
            </span>
          ))}
        </Breadcrumbs>
        {kde < cesta.length - 1 && (
          <Button rounded small className="mt-2" onClick={() => setKde(cesta.length - 1)}>
            Глубже
          </Button>
        )}
      </Block>
    )
  },

  timeline: function TimelineDemo() {
    const etapy = [
      { date: '20 сен', title: 'Связь с агентами', sub: '3 из 5 задач', color: '#2a8bff' },
      { date: '27 сен', title: 'Проверка работы', sub: '0 из 4 задач', color: 'rgba(255,255,255,.3)' },
    ]
    const [otevreny, setOtevreny] = useState<string | null>(null)
    return (
      <div className="timeline">
        {etapy.map((e) => (
          <div key={e.title} className="timeline-item">
            <div className="timeline-item-date text-[11px]">{e.date}</div>
            <div className="timeline-item-divider" style={{ background: e.color }} />
            <div className="timeline-item-content">
              <button
                type="button"
                onClick={() => setOtevreny(otevreny === e.title ? null : e.title)}
                className="timeline-item-inner w-full rounded-2xl bg-ios-light-surface-1 text-left dark:bg-ios-dark-surface-1"
              >
                <span className="timeline-item-title block text-[15px] font-semibold">
                  {e.title}
                </span>
                <span className="timeline-item-subtitle block text-[12px] opacity-60">
                  {otevreny === e.title ? 'этап открыт — тапни ещё раз' : e.sub}
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  },

  accordion: function Accordion() {
    const [open, setOpen] = useState(false)
    return (
      <List strong inset>
        <ListItem
          link
          onClick={() => setOpen(!open)}
          title="Показать подробности"
          after={
            <ChevronDown
              size={16}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          }
        />
        {open && <ListItem title="Скрытое содержимое" />}
      </List>
    )
  },
  navbar: () => (
    <div className="overflow-hidden rounded-2xl">
      <Navbar
        title="Название экрана"
        subtitle="Подзаголовок"
        left={<NavbarBackLink text="Назад" onClick={() => {}} />}
        right={
          <KLink iconOnly onClick={() => {}}>
            <MoreHorizontal size={22} />
          </KLink>
        }
      />
    </div>
  ),
  toolbar: () => (
    <div className="overflow-hidden rounded-2xl">
      <Toolbar top innerClassName="w-full">
        <div className="flex w-full items-center justify-between px-1">
          <span className="text-[17px] font-semibold">Заголовок</span>
          <KLink onClick={() => {}}>Готово</KLink>
        </div>
      </Toolbar>
    </div>
  ),
  tabbar: () => (
    <div className="overflow-hidden rounded-2xl">
      <Tabbar labels icons className="!static">
        <TabbarLink
          active
          label="Сегодня"
          icon={<CalendarDays size={22} />}
          onClick={() => {}}
        />
        <TabbarLink label="Профиль" icon={<User size={22} />} onClick={() => {}} />
      </Tabbar>
    </div>
  ),
  popup: () => (
    <Block className="!my-0">
      <Okno label="Открыть окно">
        {(open, close) => (
          <Popup open={open} onClose={close} title="Задача" onSave={close} canSave>
            <List strong inset>
              <ListItem title="Содержимое на весь экран" />
            </List>
          </Popup>
        )}
      </Okno>
    </Block>
  ),
  'sheet-modal': () => (
    <Block className="!my-0">
      <Okno label="Открыть шторку">
        {(open, close) => (
          <Sheet open={open} onClose={close} title="Статус">
            <List strong inset>
              {['Не начата', 'В работе', 'Готово'].map((o, i) => (
                <ListItem
                  key={o}
                  link
                  onClick={close}
                  title={o}
                  after={i === 1 ? <Check size={18} className="text-primary" /> : undefined}
                />
              ))}
            </List>
          </Sheet>
        )}
      </Okno>
    </Block>
  ),
  actions: () => (
    <Block className="!my-0">
      <Okno label="Открыть действия">
        {(open, close) => (
          <Actions opened={open} onBackdropClick={close}>
            <ActionsGroup>
              <ActionsLabel>Что сделать с задачей</ActionsLabel>
              <ActionsButton onClick={close}>Взять в работу</ActionsButton>
              <ActionsButton
                colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }}
                onClick={close}
              >
                Удалить
              </ActionsButton>
            </ActionsGroup>
            <ActionsGroup>
              <ActionsButton bold onClick={close}>
                Отмена
              </ActionsButton>
            </ActionsGroup>
          </Actions>
        )}
      </Okno>
    </Block>
  ),
  dialog: () => (
    <Block className="!my-0">
      <Okno label="Открыть диалог">
        {(open, close) => (
          <Dialog
            opened={open}
            onBackdropClick={close}
            title="Удалить задачу?"
            content="Её отчёт и история пропадут."
            buttons={
              <>
                <DialogButton onClick={close}>Отмена</DialogButton>
                <DialogButton strong onClick={close}>
                  Удалить
                </DialogButton>
              </>
            }
          />
        )}
      </Okno>
    </Block>
  ),
  popover: function Popovers() {
    const [open, setOpen] = useState(false)
    const btn = useRef<HTMLButtonElement | null>(null)
    return (
      <Block className="!my-0">
        <Button rounded ref={btn as never} onClick={() => setOpen(true)}>
          Открыть поповер
        </Button>
        <Vrstva>
        <Popover
          opened={open}
          target={btn.current}
          onBackdropClick={() => setOpen(false)}
        >
          <List nested>
            <ListItem link title="Изменить" onClick={() => setOpen(false)} />
            <ListItem link title="Удалить" onClick={() => setOpen(false)} />
          </List>
        </Popover>
        </Vrstva>
      </Block>
    )
  },
  panel: function PanelDemo() {
    const [open, setOpen] = useState(false)
    return (
      <Block className="!my-0">
        <Button rounded onClick={() => setOpen(true)}>
          Открыть панель
        </Button>
        <Vrstva>
        <Panel side="left" opened={open} onBackdropClick={() => setOpen(false)}>
          <Page className="!bg-ios-light-surface dark:!bg-ios-dark-surface">
            <Navbar
              title="Меню"
              colors={{ bgIos: 'bg-ios-light-surface dark:bg-ios-dark-surface' }}
              right={
                <KLink iconOnly onClick={() => setOpen(false)} aria-label="Закрыть">
                  <X size={20} />
                </KLink>
              }
            />
            <List strong inset>
              <ListItem link title="Проекты" onClick={() => setOpen(false)} />
              <ListItem link title="Агенты" onClick={() => setOpen(false)} />
            </List>
          </Page>
        </Panel>
        </Vrstva>
      </Block>
    )
  },

  toast: function ToastDemo() {
    const [open, setOpen] = useState(false)
    const [sTlacitkem, setSTlacitkem] = useState(false)
    const ukazat = (tlacitko: boolean) => {
      setSTlacitkem(tlacitko)
      setOpen(true)
      if (!tlacitko) window.setTimeout(() => setOpen(false), 2500)
    }
    return (
      <Block className="!my-0 grid gap-2">
        <Button rounded onClick={() => ukazat(false)}>
          Показать тост
        </Button>
        <Button rounded outline onClick={() => ukazat(true)}>
          Тост с кнопкой
        </Button>
        <Vrstva>
          <Toast
            opened={open}
            position="center"
            button={
              sTlacitkem ? (
                <Button clear small inline onClick={() => setOpen(false)}>
                  Отмена
                </Button>
              ) : undefined
            }
          >
            <span className="text-[14px]">Отчёт сохранён</span>
          </Toast>
        </Vrstva>
      </Block>
    )
  },

  notification: function NotificationDemo() {
    const [open, setOpen] = useState(false)
    const zavrit = useRef<number | null>(null)
    const ukazat = () => {
      setOpen(true)
      if (zavrit.current) window.clearTimeout(zavrit.current)
      zavrit.current = window.setTimeout(() => setOpen(false), 4000)
    }
    return (
      <Block className="!my-0 grid gap-2">
        <Button rounded onClick={ukazat}>
          Показать уведомление
        </Button>
        <span className="text-[13px] opacity-55">
          гаснет само через 4 секунды, смахивается вверх
        </span>
        <Vrstva>
          <Notification
            opened={open}
            icon={
              <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-[11px] font-bold text-white">
                a
              </span>
            }
            title="aiMe"
            titleRightText="сейчас"
            subtitle="Агент взял задачу"
            text="Сверстать главную"
            onClick={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </Vrstva>
      </Block>
    )
  },

  messages: function MessagesDemo() {
    const [zpravy, setZpravy] = useState([
      { type: 'received' as const, name: 'Агент', text: 'Задачу взял, начинаю' },
      { type: 'sent' as const, text: 'Ок, жду отчёт' },
    ])
    return (
      <>
        <div className="rounded-2xl bg-ios-light-surface-2 py-2 dark:bg-ios-dark-surface-2">
          <Messages>
            <MessagesTitle>воскресенье, 20 сент.</MessagesTitle>
            {zpravy.map((z, i) => (
              <Message key={i} type={z.type} name={z.name} text={z.text} />
            ))}
          </Messages>
        </div>
        <Block className="!mt-2">
          <Button
            rounded
            onClick={() =>
              setZpravy((p) => [
                ...p,
                p.length % 2
                  ? { type: 'received' as const, name: 'Агент', text: 'Готово, отчёт на доске' }
                  : { type: 'sent' as const, text: 'Как продвигается?' },
              ])
            }
          >
            Добавить сообщение
          </Button>
        </Block>
      </>
    )
  },

  messagebar: () => (
    <div className="relative h-24 overflow-hidden rounded-2xl">
      <Messagebar
        className="!absolute"
        placeholder="Сообщение"
        value=""
        onInput={() => {}}
        right={
          <ToolbarPane>
            <KLink onClick={() => {}} iconOnly aria-label="Отправить">
              <Send size={22} />
            </KLink>
          </ToolbarPane>
        }
      />
    </div>
  ),
  // свайп по-настоящему: тянем строку влево, под ней открывается «Удалить»
  swipeout: function SwipeoutDemo() {
    const [posun, setPosun] = useState(0)
    const [smazano, setSmazano] = useState(false)
    const start = useRef<number | null>(null)
    const ukazat = () => {
      setPosun(96)
      window.setTimeout(() => setPosun(0), 1400)
    }
    return (
      <>
        <div className="relative overflow-hidden rounded-3xl">
          <button
            type="button"
            onClick={() => setSmazano(true)}
            className="absolute inset-y-0 right-0 w-24 bg-[#ff3b30] text-[15px] font-semibold text-white"
          >
            Удалить
          </button>
          <div
            className="relative touch-pan-y bg-ios-light-surface-1 dark:bg-ios-dark-surface-1"
            style={{
              transform: `translateX(${-posun}px)`,
              transition: start.current === null ? 'transform .25s' : 'none',
            }}
            onPointerDown={(e) => {
              start.current = e.clientX + posun
            }}
            onPointerMove={(e) => {
              if (start.current === null) return
              setPosun(Math.max(0, Math.min(96, start.current - e.clientX)))
            }}
            onPointerUp={() => {
              setPosun(posun > 48 ? 96 : 0)
              start.current = null
            }}
          >
            <div className="flex min-h-14 items-center px-4 text-[17px]">
              {smazano ? 'Удалено' : 'Задача со свайпом'}
            </div>
          </div>
        </div>
        <Block className="!mt-2 flex gap-2">
          <Button rounded small onClick={ukazat}>
            Показать свайп
          </Button>
          {smazano && (
            <Button rounded small clear onClick={() => setSmazano(false)}>
              Вернуть
            </Button>
          )}
        </Block>
      </>
    )
  },

  'sortable-list': function SortableDemo() {
    const [radky, setRadky] = useState(['Авторизация', 'Профиль', 'Оплата'])
    const presun = (od: number, kam: number) => {
      if (kam < 0 || kam >= radky.length) return
      const dalsi = [...radky]
      const [x] = dalsi.splice(od, 1)
      dalsi.splice(kam, 0, x)
      setRadky(dalsi)
      haptic('light')
    }
    return (
      <List strong inset dividers>
        {radky.map((title, i) => (
          <ListItem
            key={title}
            title={title}
            after={
              <span className="flex items-center gap-1">
                <KLink onClick={() => presun(i, i - 1)} aria-label="Выше">
                  <ChevronUp size={18} />
                </KLink>
                <KLink onClick={() => presun(i, i + 1)} aria-label="Ниже">
                  <ChevronDown size={18} />
                </KLink>
                <GripVertical size={18} className="text-black/25 dark:text-white/25" />
              </span>
            }
          />
        ))}
      </List>
    )
  },

  // умный выбор: строка открывает шторку со списком, как у f7
  'smart-select': function SmartSelectDemo() {
    const [value, setValue] = useState('Разработчик')
    const [open, setOpen] = useState(false)
    const volby = ['Разработчик', 'Проверяющий', 'Аналитик', 'Дизайнер']
    return (
      <>
        <List strong inset>
          <ListItem link title="Роль" after={value} onClick={() => setOpen(true)} />
        </List>
        <Vrstva>
        <Sheet open={open} onClose={() => setOpen(false)} title="Роль">
          <List strong inset>
            {volby.map((o) => (
              <ListItem
                key={o}
                link
                title={o}
                onClick={() => {
                  setValue(o)
                  setOpen(false)
                }}
                after={o === value ? <Check size={18} className="text-primary" /> : undefined}
              />
            ))}
          </List>
        </Sheet>
        </Vrstva>
      </>
    )
  },

  // календарь: листается по месяцам, дата выбирается тапом
  calendar: function CalendarDemo() {
    const dnes = new Date()
    const [mesic, setMesic] = useState(new Date(dnes.getFullYear(), dnes.getMonth(), 1))
    const [vybrano, setVybrano] = useState<string>(
      new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate()).toDateString(),
    )
    const start = useRef<number | null>(null)

    const posunMesic = (o: number) =>
      setMesic((m) => new Date(m.getFullYear(), m.getMonth() + o, 1))

    // сетка 6×7: с хвостом прошлого месяца и началом следующего — как в f7
    const prvni = new Date(mesic.getFullYear(), mesic.getMonth(), 1)
    const posun = (prvni.getDay() + 6) % 7
    const zacatek = new Date(prvni)
    zacatek.setDate(prvni.getDate() - posun)
    const bunky = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(zacatek)
      d.setDate(zacatek.getDate() + i)
      return d
    })

    return (
      <List strong inset>
        <ListItem
          title={
            <span className="flex h-8 items-center justify-between">
              <KLink iconOnly onClick={() => posunMesic(-1)} aria-label="Предыдущий месяц">
                <ChevronLeft size={20} />
              </KLink>
              <span className="text-[17px] font-semibold">
                {mesic.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
              </span>
              <KLink iconOnly onClick={() => posunMesic(1)} aria-label="Следующий месяц">
                <ChevronRight size={20} />
              </KLink>
            </span>
          }
        />
        <ListItem
          title={
            <span
              className="block select-none py-1"
              onPointerDown={(e) => (start.current = e.clientX)}
              onPointerUp={(e) => {
                if (start.current === null) return
                const dx = e.clientX - start.current
                start.current = null
                if (Math.abs(dx) > 40) posunMesic(dx > 0 ? -1 : 1)
              }}
            >
              <span className="grid grid-cols-7 text-center text-[11px] leading-[18px] text-black/40 dark:text-white/40">
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
              <span className="mt-1 grid grid-cols-7 gap-y-1">
                {bunky.map((d) => {
                  const cizi = d.getMonth() !== mesic.getMonth()
                  const jeDnes = d.toDateString() === dnes.toDateString()
                  const jeVybrano = d.toDateString() === vybrano
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => {
                        setVybrano(d.toDateString())
                        if (cizi) posunMesic(d < prvni ? -1 : 1)
                        haptic('light')
                      }}
                      className={`mx-auto grid h-[30px] w-[30px] place-items-center rounded-full text-[15px] ${
                        jeVybrano
                          ? 'bg-primary text-white'
                          : jeDnes
                            ? 'bg-black/[.08] dark:bg-white/[.18]'
                            : ''
                      } ${cizi ? 'opacity-30' : ''}`}
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </span>
            </span>
          }
        />
        <ListItem
          title="Выбрано"
          after={new Date(vybrano).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        />
      </List>
    )
  },

  picker: function PickerDemo() {
    const sloupce = [
      Array.from({ length: 28 }, (_, i) => String(i + 1)),
      ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
       'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      ['2025', '2026', '2027'],
    ]
    const VYSKA = 36
    const [vybr, setVybr] = useState([19, 8, 1])
    // при открытии подкручиваем колонки к выбранному — иначе в окне
    // стоит одно, а подписано другое
    const pasy = useRef<(HTMLSpanElement | null)[]>([])
    useEffect(() => {
      pasy.current.forEach((el, i) => {
        if (el) el.scrollTop = vybr[i] * VYSKA
      })
      // только на первом показе
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const nastav = (si: number, vi: number) =>
      setVybr((p) => {
        if (p[si] === vi) return p
        haptic('light')
        const d = [...p]
        d[si] = vi
        return d
      })
    return (
      <List strong inset>
        <ListItem
          title={
            <span className="relative block py-1">
              {/* окно выбора — как у f7 */}
              <span
                className="pointer-events-none absolute inset-x-0 top-1/2 block -translate-y-1/2 rounded-lg bg-black/[.06] dark:bg-white/10"
                style={{ height: VYSKA }}
              />
              <span className="grid grid-cols-3">
                {sloupce.map((sloupec, si) => (
                  <span
                    key={si}
                    ref={(el) => {
                      pasy.current[si] = el
                    }}
                    onScroll={(e) =>
                      nastav(si, Math.round((e.target as HTMLElement).scrollTop / VYSKA))
                    }
                    className="block h-[108px] snap-y snap-mandatory overflow-y-auto text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ scrollPaddingBlock: VYSKA }}
                  >
                    <span className="block" style={{ height: VYSKA }} />
                    {sloupec.map((v, vi) => (
                      <span
                        key={v}
                        className={`flex snap-center items-center justify-center text-[17px] transition-opacity ${
                          vybr[si] === vi ? 'font-semibold opacity-100' : 'opacity-35'
                        }`}
                        style={{ height: VYSKA }}
                      >
                        {v}
                      </span>
                    ))}
                    <span className="block" style={{ height: VYSKA }} />
                  </span>
                ))}
              </span>
            </span>
          }
        />
        <ListItem
          title="Выбрано"
          after={sloupce.map((sl, i) => sl[vybr[i]]).join(' ')}
        />
      </List>
    )
  },

  'text-editor': function TextEditorDemo() {
    const pole = useRef<HTMLDivElement | null>(null)
    const prikaz = (cmd: string) => {
      pole.current?.focus()
      document.execCommand(cmd)
    }
    return (
      <List strong inset>
        <ListItem
          title={
            <span className="block py-1">
              <span className="mb-2 flex gap-1.5">
                {[
                  ['bold', 'Ж'],
                  ['italic', 'К'],
                  ['underline', 'Ч'],
                  ['insertUnorderedList', '• список'],
                ].map(([cmd, label]) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => prikaz(cmd)}
                    className="min-h-8 rounded-lg bg-black/[.06] px-3 text-[13px] font-semibold dark:bg-white/10"
                  >
                    {label}
                  </button>
                ))}
              </span>
              <span
                ref={pole}
                contentEditable
                suppressContentEditableWarning
                className="block min-h-20 rounded-xl bg-black/[.04] p-3 text-[15px] font-normal outline-none dark:bg-white/[.06]"
              >
                Выдели текст и нажми кнопку — начертание поменяется.
              </span>
            </span>
          }
        />
      </List>
    )
  },

  tabs: function TabsDemo() {
    const [tab, setTab] = useState('overview')
    return (
      <div className="mx-4 overflow-hidden rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1">
        <div className="flex border-b border-black/[.07] dark:border-white/[.08]">
          {[
            ['overview', 'Обзор'],
            ['files', 'Файлы'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`relative flex-1 py-3 text-[14px] font-semibold ${tab === id ? 'text-primary' : 'opacity-45'}`}
            >
              {label}
              {tab === id && <span className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
        <div className="p-4 text-[14px]">{tab === 'overview' ? 'Обзор проекта' : 'Файлы проекта'}</div>
      </div>
    )
  },
  grid: function GridDemo() {
    const [vybrana, setVybrana] = useState<number | null>(null)
    return (
      <Block className="!my-0 grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setVybrana(vybrana === i ? null : i)}
            className={`grid h-16 place-items-center rounded-2xl text-[14px] font-semibold ${
              vybrana === i
                ? 'bg-primary text-white'
                : 'bg-ios-light-surface-1 dark:bg-ios-dark-surface-1'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </Block>
    )
  },

  skeleton: function SkeletonDemo() {
    const [nacteno, setNacteno] = useState(false)
    return (
      <>
        <List strong inset>
          {nacteno ? (
            <ListItem
              media={
                <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 font-semibold text-primary">
                  Р
                </span>
              }
              title="Разраб"
              subtitle="взял задачу «Сверстать главную»"
            />
          ) : (
            <ListItem
              media={<span className="h-11 w-11 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />}
              title={<span className="block h-3 w-2/3 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />}
              subtitle={<span className="mt-2 block h-3 w-full animate-pulse rounded-full bg-black/[.07] dark:bg-white/[.07]" />}
            />
          )}
        </List>
        <Block className="!mt-2">
          <Button rounded onClick={() => setNacteno((n) => !n)}>
            {nacteno ? 'Показать скелет' : 'Загрузить данные'}
          </Button>
        </Block>
      </>
    )
  },

  gauge: function GaugeDemo() {
    const [procenta, setProcenta] = useState(72)
    const bezi = useRef<number | null>(null)
    const spustit = () => {
      if (bezi.current) window.clearInterval(bezi.current)
      const cil = Math.round(20 + Math.random() * 80)
      bezi.current = window.setInterval(() => {
        setProcenta((p) => {
          if (p === cil) {
            if (bezi.current) window.clearInterval(bezi.current)
            return p
          }
          return p + Math.sign(cil - p)
        })
      }, 12)
    }
    return (
      <Block className="!my-0 grid justify-items-center gap-3">
        <span
          className="grid h-32 w-32 place-items-center rounded-full"
          style={{
            background: `conic-gradient(#007aff 0 ${procenta}%, rgba(120,120,128,.18) ${procenta}% 100%)`,
          }}
        >
          <span className="grid h-[104px] w-[104px] place-items-center rounded-full bg-ios-light-surface-2 text-center dark:bg-ios-dark-surface-2">
            <span>
              <span className="block text-[25px] font-bold tabular-nums">{procenta}%</span>
              <span className="block text-[12px] opacity-45">готово</span>
            </span>
          </span>
        </span>
        <span className="w-full">
          <Range
            value={procenta}
            min={0}
            max={100}
            step={1}
            onChange={(e) => setProcenta(Number((e.target as HTMLInputElement).value))}
          />
        </span>
        <Button rounded small onClick={spustit}>
          Запустить анимацию
        </Button>
      </Block>
    )
  },

  'pie-chart': function PieDemo() {
    const casti = [
      { name: 'Готово', v: 45, c: '#30d158' },
      { name: 'В работе', v: 30, c: '#2a8bff' },
      { name: 'Не начата', v: 25, c: '#8e8e93' },
    ]
    const [aktivni, setAktivni] = useState<number | null>(null)
    const polomer = 56
    let uhel = -90
    const sektory = casti.map((c) => {
      const od = uhel
      const do_ = uhel + (c.v / 100) * 360
      uhel = do_
      const bod = (a: number) => [
        64 + polomer * Math.cos((a * Math.PI) / 180),
        64 + polomer * Math.sin((a * Math.PI) / 180),
      ]
      const [x1, y1] = bod(od)
      const [x2, y2] = bod(do_)
      const velky = do_ - od > 180 ? 1 : 0
      return { ...c, d: `M64,64 L${x1},${y1} A${polomer},${polomer} 0 ${velky} 1 ${x2},${y2} Z` }
    })
    return (
      <Block className="!my-0 grid justify-items-center gap-2">
        <svg viewBox="0 0 128 128" className="h-32 w-32">
          {sektory.map((sek, i) => (
            <path
              key={sek.name}
              d={sek.d}
              fill={sek.c}
              opacity={aktivni === null || aktivni === i ? 1 : 0.35}
              onClick={() => setAktivni(aktivni === i ? null : i)}
              style={{ cursor: 'pointer' }}
            />
          ))}
          <circle cx="64" cy="64" r="34" className="fill-ios-light-surface-2 dark:fill-ios-dark-surface-2" />
          <text x="64" y="69" textAnchor="middle" className="fill-current text-[15px] font-semibold">
            {aktivni === null ? '100%' : `${casti[aktivni].v}%`}
          </text>
        </svg>
        <span className="text-[13px] opacity-55">
          {aktivni === null ? 'тапни сектор' : casti[aktivni].name}
        </span>
      </Block>
    )
  },

  'area-chart': function AreaDemo() {
    const body = [4, 9, 6, 12, 8, 14, 11]
    const dny = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
    const [aktivni, setAktivni] = useState<number | null>(null)
    const max = Math.max(...body)
    const xy = (v: number, i: number): [number, number] => [
      (i / (body.length - 1)) * 100,
      40 - (v / max) * 34,
    ]
    const cesta = body.map((v, i) => xy(v, i).join(',')).join(' ')
    return (
      <Block className="!my-0 grid gap-2">
        <svg viewBox="0 0 100 44" className="h-28 w-full">
          <polygon points={`0,44 ${cesta} 100,44`} fill="rgba(42,139,255,.22)" />
          <polyline points={cesta} fill="none" stroke="#2a8bff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {body.map((v, i) => {
            const [x, y] = xy(v, i)
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={aktivni === i ? 3 : 2}
                fill={aktivni === i ? '#2a8bff' : 'white'}
                stroke="#2a8bff"
                strokeWidth="1"
                onClick={() => setAktivni(aktivni === i ? null : i)}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
        </svg>
        <span className="text-center text-[13px] opacity-55">
          {aktivni === null ? 'тапни точку' : `${dny[aktivni]}: ${body[aktivni]} задач`}
        </span>
      </Block>
    )
  },

  'pull-to-refresh': function PullDemo() {
    const [tah, setTah] = useState(0)
    const [obnovuje, setObnovuje] = useState(false)
    const [kdy, setKdy] = useState<string | null>(null)
    const start = useRef<number | null>(null)
    const obnovit = () => {
      setObnovuje(true)
      window.setTimeout(() => {
        setObnovuje(false)
        setTah(0)
        setKdy(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      }, 900)
    }
    return (
      <div
        className="overflow-hidden rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1"
        onPointerDown={(e) => (start.current = e.clientY)}
        onPointerMove={(e) => {
          if (start.current === null || obnovuje) return
          setTah(Math.max(0, Math.min(70, e.clientY - start.current)))
        }}
        onPointerUp={() => {
          start.current = null
          if (tah > 45) obnovit()
          else setTah(0)
        }}
      >
        <div
          className="flex items-center justify-center overflow-hidden text-[13px] opacity-60"
          style={{ height: obnovuje ? 44 : tah, transition: start.current === null ? 'height .2s' : 'none' }}
        >
          {obnovuje ? <Preloader className="h-5 w-5" /> : 'тяни вниз'}
        </div>
        <div className="flex items-center justify-between px-4 py-4 text-[15px]">
          <span>{kdy ? `Обновлено в ${kdy}` : 'Потяни вниз или нажми'}</span>
          <Button rounded small onClick={obnovit}>
            Обновить
          </Button>
        </div>
      </div>
    )
  },

  'infinite-scroll': function InfiniteDemo() {
    const [kolik, setKolik] = useState(8)
    const [nacita, setNacita] = useState(false)
    const dobrat = () => {
      if (nacita) return
      setNacita(true)
      window.setTimeout(() => {
        setKolik((k) => k + 5)
        setNacita(false)
      }, 500)
    }
    return (
      <div
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) dobrat()
        }}
        className="max-h-56 overflow-y-auto rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1"
      >
        {Array.from({ length: kolik }, (_, i) => (
          <div
            key={i}
            className="flex h-11 items-center border-b border-black/[.06] px-4 text-[15px] dark:border-white/[.08]"
          >
            Элемент {i + 1}
          </div>
        ))}
        <div className="flex items-center justify-center gap-2 py-3">
          {nacita ? (
            <Preloader className="h-5 w-5" />
          ) : (
            <Button rounded small onClick={dobrat}>
              Загрузить ещё
            </Button>
          )}
        </div>
      </div>
    )
  },

  'login-screen': function LoginDemo() {
    const [mail, setMail] = useState('')
    const [heslo, setHeslo] = useState('')
    const [vesel, setVesel] = useState(false)
    return (
      <>
        <BlockTitle className="!text-center">aiMe</BlockTitle>
        <List strong inset>
          <ListInput
            label="Почта"
            type="email"
            placeholder="you@example.com"
            value={mail}
            onChange={(e) => setMail((e.target as HTMLInputElement).value)}
          />
          <ListInput
            label="Пароль"
            type="password"
            placeholder="••••••"
            value={heslo}
            onChange={(e) => setHeslo((e.target as HTMLInputElement).value)}
          />
        </List>
        <Block className="!mt-2">
          <Button large rounded onClick={() => setVesel(true)}>
            {vesel ? 'Добро пожаловать' : 'Войти'}
          </Button>
        </Block>
      </>
    )
  },

  'photo-browser': function PhotoBrowserDemo() {
    const snimky = [
      { id: '1', url: '/providers/gpt.png', kind: 'image' as const },
      { id: '2', url: '/providers/claude.png', kind: 'image' as const },
      { id: '3', url: '/providers/gemini.png', kind: 'image' as const },
    ]
    const [index, setIndex] = useState<number | null>(null)
    return (
      <>
        <div className="flex gap-2">
          {snimky.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              className="h-20 flex-1 overflow-hidden rounded-2xl bg-ios-light-surface-1 active:opacity-70 dark:bg-ios-dark-surface-1"
            >
              <img src={s.url} alt="" className="h-full w-full object-contain p-3" />
            </button>
          ))}
        </div>
        <Block className="!mt-2">
          <Button rounded small onClick={() => setIndex(0)}>
            Открыть просмотр
          </Button>
        </Block>
        <Vrstva>
          <PhotoBrowser items={snimky} index={index} onClose={() => setIndex(null)} />
        </Vrstva>
      </>
    )
  },

  tooltip: function TooltipDemo() {
    const [open, setOpen] = useState(false)
    return (
      <List strong inset>
        <ListItem
          title="Исполнитель"
          after={
            <span className="relative inline-flex">
              {open && (
                <span className="absolute bottom-full right-0 mb-2 w-52 rounded-xl bg-black px-3 py-2 text-[12px] leading-snug text-white shadow-lg dark:bg-white dark:text-black">
                  Кому уйдёт задача, когда её возьмут в работу
                  <span className="absolute -bottom-1 right-3 h-2 w-2 rotate-45 bg-black dark:bg-white" />
                </span>
              )}
              <KLink
                iconOnly
                onClick={() => setOpen((o) => !o)}
                aria-label="Подсказка"
              >
                <HelpCircle size={20} />
              </KLink>
            </span>
          }
        />
      </List>
    )
  },

  block: function BlockDemo() {
    const [vic, setVic] = useState(false)
    return (
      <>
        <BlockTitle>Заголовок раздела</BlockTitle>
        <BlockHeader>Подзаголовок над блоком</BlockHeader>
        <Block strong inset>
          Обычный текстовый блок: пояснение, предупреждение, что угодно.
          {vic && (
            <span className="mt-2 block opacity-70">
              Второй абзац — появляется по кнопке, чтобы блок было куда тыкнуть.
            </span>
          )}
          <span className="mt-2 block">
            <Button rounded small onClick={() => setVic((v) => !v)}>
              {vic ? 'Свернуть' : 'Показать ещё'}
            </Button>
          </span>
        </Block>
        <BlockFooter>Мелкая подпись под блоком.</BlockFooter>
      </>
    )
  },

  link: () => (
    <Block className="!my-0 flex flex-wrap items-center gap-4">
      <KLink onClick={() => {}}>Обычная</KLink>
      <KLink iconOnly onClick={() => {}} aria-label="Меню">
        <MoreHorizontal size={20} />
      </KLink>
      <KLink href="https://framework7.io" target="_blank">
        Внешняя
      </KLink>
    </Block>
  ),
  icons: function IconsDemo() {
    const ikony: [string, typeof Check][] = [
      ['check', Check],
      ['plus', Plus],
      ['user', User],
      ['send', Send],
      ['calendar-days', CalendarDays],
      ['help-circle', HelpCircle],
    ]
    const [vybrana, setVybrana] = useState<string | null>(null)
    return (
      <Block className="!my-0">
        <span className="flex flex-wrap gap-3">
          {ikony.map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setVybrana(name)
                navigator.clipboard?.writeText(`<${name} />`).catch(() => {})
                haptic('light')
              }}
              className={`grid h-11 w-11 place-items-center rounded-2xl ${
                vybrana === name
                  ? 'bg-primary text-white'
                  : 'bg-ios-light-surface-1 text-primary dark:bg-ios-dark-surface-1'
              }`}
              aria-label={name}
            >
              <Icon size={22} />
            </button>
          ))}
        </span>
        <span className="mt-2 block text-[13px] opacity-55">
          {vybrana ? `скопировано: ${vybrana}` : 'тапни иконку — имя уйдёт в буфер'}
        </span>
      </Block>
    )
  },

  subnavbar: () => (
    <div className="overflow-hidden rounded-2xl">
      <Navbar
        title="Проект"
        colors={{ bgIos: 'bg-ios-light-surface-1 dark:bg-ios-dark-surface-1' }}
        subnavbar={
          <Segmented strong rounded>
            <SegmentedButton active>Задачи</SegmentedButton>
            <SegmentedButton>Файлы</SegmentedButton>
          </Segmented>
        }
      />
    </div>
  ),
  swiper: function SwiperDemo() {
    const slajdy = ['Слайд один', 'Слайд два', 'Слайд три']
    const [aktivni, setAktivni] = useState(0)
    const pas = useRef<HTMLDivElement | null>(null)
    const skocit = (i: number) => {
      setAktivni(i)
      const el = pas.current
      if (el) el.scrollTo({ left: i * (el.clientWidth * 0.72 + 12), behavior: 'smooth' })
    }
    return (
      <>
        <div
          ref={pas}
          onScroll={(e) => {
            const el = e.currentTarget
            setAktivni(Math.round(el.scrollLeft / (el.clientWidth * 0.72 + 12)))
          }}
          className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slajdy.map((s) => (
            <div
              key={s}
              className="flex h-28 w-[72%] shrink-0 snap-center items-center justify-center rounded-2xl bg-ios-light-surface-1 text-[15px] font-semibold dark:bg-ios-dark-surface-1"
            >
              {s}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-center gap-1.5">
          {slajdy.map((s, i) => (
            <button
              key={s}
              type="button"
              aria-label={`Слайд ${i + 1}`}
              onClick={() => skocit(i)}
              className={`h-2 rounded-full transition-all ${
                i === aktivni ? 'w-5 bg-primary' : 'w-2 bg-black/20 dark:bg-white/25'
              }`}
            />
          ))}
        </div>
      </>
    )
  },

  treeview: function TreeviewDemo() {
    const uzly = [
      { name: 'frontend', deti: ['pages', 'components', 'lib'] },
      { name: 'tasks-board', deti: ['server.py', 'mcp_board.py'] },
    ]
    const [otevrene, setOtevrene] = useState<Set<string>>(new Set(['frontend']))
    const prepnout = (name: string) =>
      setOtevrene((p) => {
        const d = new Set(p)
        d.has(name) ? d.delete(name) : d.add(name)
        return d
      })
    return (
      <List strong inset>
        {uzly.map((u) => (
          <div key={u.name}>
            <ListItem
              link
              title={u.name}
              onClick={() => prepnout(u.name)}
              media={
                <ChevronRight
                  size={16}
                  className={`transition-transform ${otevrene.has(u.name) ? 'rotate-90' : ''}`}
                />
              }
            />
            {otevrene.has(u.name) &&
              u.deti.map((d) => (
                <ListItem key={d} title={d} innerClassName="!pl-8" />
              ))}
          </div>
        ))}
      </List>
    )
  },
  'virtual-list': function VirtualListDemo() {
    const vsech = 500
    const vyska = 44
    const [od, setOd] = useState(0)
    const [kliknuto, setKliknuto] = useState<number | null>(null)
    const okno = Array.from({ length: 12 }, (_, i) => od + i).filter((i) => i < vsech)
    return (
      <div
        onScroll={(e) => setOd(Math.floor(e.currentTarget.scrollTop / vyska))}
        className="max-h-60 overflow-y-auto rounded-3xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1"
      >
        <div style={{ height: vsech * vyska }} className="relative">
          <div style={{ transform: `translateY(${od * vyska}px)` }}>
            {okno.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setKliknuto(i)}
                style={{ height: vyska }}
                className="flex w-full items-center justify-between border-b border-black/[.06] px-4 text-left text-[15px] active:bg-black/5 dark:border-white/[.08] dark:active:bg-white/10"
              >
                <span>Строка {i + 1}</span>
                {kliknuto === i && <Check size={17} className="text-primary" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  },

  'list-index': function ListIndexDemo() {
    const skupiny: [string, string[]][] = [
      ['А', ['Алексей', 'Анна', 'Артём']],
      ['Б', ['Борис', 'Богдан']],
      ['В', ['Вера', 'Виктор']],
      ['Г', ['Глеб']],
    ]
    const pas = useRef<HTMLDivElement | null>(null)
    const skocit = (p: string) => {
      haptic('light')
      const cil = pas.current?.querySelector(`[data-pismeno="${p}"]`)
      cil?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    return (
      <div className="relative">
        <div ref={pas} className="max-h-64 overflow-y-auto rounded-3xl">
          <List strong inset>
            {skupiny.map(([pismeno, jmena]) => (
              <div key={pismeno} data-pismeno={pismeno}>
                <ListItem title={pismeno} groupTitle />
                {jmena.map((j) => (
                  <ListItem key={j} link title={j} onClick={() => {}} />
                ))}
              </div>
            ))}
          </List>
        </div>
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-full bg-black/[.04] px-1 py-1.5 text-[11px] font-semibold text-primary dark:bg-white/[.06]">
          {skupiny.map(([p]) => (
            <button key={p} type="button" onClick={() => skocit(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    )
  },

  'contacts-list': function ContactsDemo() {
    const [kdo, setKdo] = useState<string | null>(null)
    return (
      <List strong inset dividers>
        {[
          ['А', ['Алексей', 'Анна']],
          ['Б', ['Борис']],
        ].map(([pismeno, jmena]) => (
          <div key={pismeno as string}>
            <ListItem title={pismeno as string} groupTitle />
            {(jmena as string[]).map((j) => (
              <ListItem
                key={j}
                link
                title={j}
                onClick={() => setKdo(j)}
                after={kdo === j ? 'выбран' : undefined}
              />
            ))}
          </div>
        ))}
      </List>
    )
  },

  'data-table': function DataTableDemo() {
    const [vybrane, setVybrane] = useState<number[]>([])
    const radky = [
      { id: 1, title: 'Сверстать главную', tokens: '12 400' },
      { id: 2, title: 'Прикрутить кассу', tokens: '8 900' },
    ]
    const prepnout = (id: number) =>
      setVybrane((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    return (
      <Table>
        <TableHead>
          <TableRow header>
            <TableCell header>Задача</TableCell>
            <TableCell header className="text-right">Токены</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {radky.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <button
                  type="button"
                  onClick={() => prepnout(r.id)}
                  className="flex items-center gap-2 text-left"
                >
                  <Checkbox component="span" checked={vybrane.includes(r.id)} onChange={() => prepnout(r.id)} />
                  {r.title}
                </button>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.tokens}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  },

  autocomplete: function AutocompleteDemo() {
    const vse = ['aiMe', 'Working VPN', 'wMusic', 'Транскрибатор', 'perunfx']
    const [q, setQ] = useState('')
    const navrhy = q.trim()
      ? vse.filter((v) => v.toLowerCase().includes(q.trim().toLowerCase()) && v !== q)
      : []
    return (
      <List strong inset>
        <ListInput
          label="Проект"
          type="text"
          placeholder="Начни печатать"
          value={q}
          onChange={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {navrhy.map((n) => (
          <ListItem key={n} link title={n} onClick={() => setQ(n)} />
        ))}
      </List>
    )
  },
  'color-picker': function ColorPickerDemo() {
    const [odstin, setOdstin] = useState(210)
    const barvy = ['#007aff', '#30d158', '#bf5af2', '#ff9f0a', '#ff375f', '#64d2ff']
    const [barva, setBarva] = useState(barvy[0])
    const zOdstinu = `hsl(${odstin} 90% 55%)`
    return (
      <Block className="!my-0 grid gap-3">
        <span className="flex items-center gap-3">
          <span className="h-12 w-12 rounded-2xl" style={{ background: barva }} />
          <span className="text-[15px] font-medium">{barva}</span>
        </span>
        <span className="flex flex-wrap gap-3">
          {barvy.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              onClick={() => setBarva(c)}
              className="h-9 w-9 rounded-full active:opacity-70"
              style={{ background: c }}
            >
              {barva === c && <Check size={18} className="mx-auto text-white" />}
            </button>
          ))}
        </span>
        <span className="block">
          <Range
            value={odstin}
            min={0}
            max={360}
            step={1}
            onChange={(e) => {
              const v = Number((e.target as HTMLInputElement).value)
              setOdstin(v)
              setBarva(`hsl(${v} 90% 55%)`)
            }}
          />
          <span className="mt-1 block text-[13px] opacity-55">оттенок: {zOdstinu}</span>
        </span>
      </Block>
    )
  },
  statusbar: function StatusbarDemo() {
    const [svetla, setSvetla] = useState(false)
    return (
      <Block className="!my-0 grid gap-2">
        <span className="overflow-hidden rounded-2xl">
          <span
            className={`flex h-9 items-center justify-between px-4 text-[13px] font-semibold ${
              svetla ? 'bg-white text-black' : 'bg-black text-white'
            }`}
          >
            <span>16:22</span>
            <span className="flex items-center gap-1 opacity-70">
              <span>LTE</span>
              <span>100%</span>
            </span>
          </span>
          <span className="block">
            <Navbar
              title="Экран"
              colors={{ bgIos: svetla ? 'bg-white' : 'bg-ios-dark-surface-1' }}
            />
          </span>
        </span>
        <Button rounded small onClick={() => setSvetla((s) => !s)}>
          {svetla ? 'Тёмный статус-бар' : 'Светлый статус-бар'}
        </Button>
      </Block>
    )
  },

}

export { ucastnik }
