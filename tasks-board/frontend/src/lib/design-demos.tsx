import { useRef, useState } from 'react'
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  Badge,
  Block,
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
  GripVertical,
  HelpCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  User,
} from 'lucide-react'
import Popup from '../components/Popup'
import Sheet from '../components/Sheet'
import Pill from '../components/Pill'
import '../f7-timeline.css'

// Живые примеры блоков. Рядом с каждым в каталоге лежит его код —
// агент копирует кусок и собирает из таких кирпичей экран.
const ucastnik = { id: 'demo', name: 'Разраб', kind: 'agent' as const }

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
      {children(open, () => setOpen(false))}
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
  'list-media': () => (
    <List strong inset dividers>
      <ListItem
        media={
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 font-semibold text-primary">
            Р
          </span>
        }
        title="Разраб"
        subtitle="пишет код"
        after={<Pill tone="bot">берёт задачи</Pill>}
      />
      <ListItem
        media={
          <span className="grid h-10 w-10 place-items-center rounded-full bg-black/10 font-semibold dark:bg-white/10">
            N
          </span>
        }
        title="NightWorkrr"
        subtitle="проверяет"
        after={<Pill tone="free">новых не берёт</Pill>}
      />
    </List>
  ),
  'list-group': () => (
    <List strong inset>
      <ListItem title="А" groupTitle />
      <ListItem title="Алексей" />
      <ListItem title="Б" groupTitle />
      <ListItem title="Борис" />
    </List>
  ),
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
  fab: () => (
    <Block className="!my-0 flex justify-center">
      <Fab
        className="!static"
        icon={<Plus size={22} />}
        onClick={() => {}}
      />
    </Block>
  ),
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
  badge: () => (
    <List strong inset>
      <ListItem title="Непрочитанные" after={<Badge>7</Badge>} />
    </List>
  ),
  card: () => (
    <Card header="Заголовок карточки" footer="Подпись снизу">
      Содержимое карточки: текст, список, что угодно.
    </Card>
  ),
  progressbar: () => (
    <Block className="!my-0">
      <Progressbar progress={0.45} />
    </Block>
  ),
  preloader: () => (
    <Block className="!my-0 flex justify-center">
      <Preloader />
    </Block>
  ),
  table: () => (
    <Table>
      <TableHead>
        <TableRow header>
          <TableCell header>Задача</TableCell>
          <TableCell header>Статус</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>Сверстать главную</TableCell>
          <TableCell>В работе</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Прикрутить кассу</TableCell>
          <TableCell>Не начата</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
  breadcrumbs: () => (
    <Block className="!my-0">
      <Breadcrumbs>
        <BreadcrumbsItem onClick={() => {}}>Проект</BreadcrumbsItem>
        <BreadcrumbsSeparator />
        <BreadcrumbsItem active>Этап</BreadcrumbsItem>
      </Breadcrumbs>
    </Block>
  ),
  timeline: () => (
    <div className="timeline">
      <div className="timeline-item">
        <div className="timeline-item-date text-[11px]">20 сен</div>
        <div className="timeline-item-divider" style={{ background: '#2a8bff' }} />
        <div className="timeline-item-content">
          <div className="timeline-item-inner rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1">
            <div className="timeline-item-title text-[15px] font-semibold">
              Название этапа
            </div>
            <div className="timeline-item-subtitle text-[12px] opacity-60">
              3 из 5 задач
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
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
      </Block>
    )
  },
  panel: () => (
    <Block className="!my-0 text-[13px] opacity-60">
      Боковая панель занимает весь экран — смотри код рядом.
    </Block>
  ),
  toast: () => (
    <Block className="!my-0">
      <Okno label="Показать тост">
        {(open, close) => (
          <Toast
            opened={open}
            position="center"
            button={
              <Button clear onClick={close}>
                Закрыть
              </Button>
            }
          >
            <span>Сохранено</span>
          </Toast>
        )}
      </Okno>
    </Block>
  ),
  notification: () => (
    <Block className="!my-0">
      <Okno label="Показать уведомление">
        {(open, close) => (
          <Notification
            opened={open}
            title="Доска"
            titleRightText="сейчас"
            subtitle="Агент взял задачу"
            text="Сверстать главную"
            onClose={close}
          />
        )}
      </Okno>
    </Block>
  ),
  messages: () => (
    <div className="rounded-2xl bg-ios-light-surface-2 py-2 dark:bg-ios-dark-surface-2">
      <Messages>
        <MessagesTitle>воскресенье, 20 сент.</MessagesTitle>
        <Message type="received" name="Агент" text="Задачу взял, начинаю" />
        <Message type="sent" text="Ок, жду отчёт" />
      </Messages>
    </div>
  ),
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
  swipeout: () => (
    <div className="mx-4 overflow-hidden rounded-2xl bg-[#ff3b30]">
      <div className="flex min-h-14 items-stretch">
        <div className="flex flex-1 items-center bg-ios-light-surface-1 px-4 text-[15px] font-medium dark:bg-ios-dark-surface-1">
          Задача со свайпом
        </div>
        <button type="button" className="px-4 text-[13px] font-semibold text-white">
          Удалить
        </button>
      </div>
    </div>
  ),
  'sortable-list': () => (
    <List strong inset dividers>
      {['Авторизация', 'Профиль', 'Оплата'].map((title) => (
        <ListItem
          key={title}
          title={title}
          after={<GripVertical size={19} className="text-black/25 dark:text-white/25" />}
        />
      ))}
    </List>
  ),
  'smart-select': function SmartSelectDemo() {
    const [value, setValue] = useState('Разработчик')
    return (
      <List strong inset>
        <ListItem
          link
          title="Исполнитель"
          after={value}
          onClick={() => setValue(value === 'Разработчик' ? 'Проверяющий' : 'Разработчик')}
        />
      </List>
    )
  },
  calendar: () => (
    <div className="mx-4 rounded-2xl bg-ios-light-surface-1 p-4 dark:bg-ios-dark-surface-1">
      <div className="mb-3 text-center text-[16px] font-semibold">Сентябрь 2026</div>
      <div className="grid grid-cols-7 gap-y-2 text-center text-[12px]">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
          <span key={day} className="text-black/35 dark:text-white/35">{day}</span>
        ))}
        {Array.from({ length: 35 }, (_, index) => index - 1).map((day, index) => (
          <span
            key={index}
            className={`grid h-8 place-items-center rounded-full ${day === 20 ? 'bg-primary font-semibold text-white' : ''}`}
          >
            {day > 0 && day <= 30 ? day : ''}
          </span>
        ))}
      </div>
    </div>
  ),
  picker: () => (
    <div className="relative mx-4 h-36 overflow-hidden rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1">
      <div className="absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 border-y border-black/10 bg-black/[.03] dark:border-white/10 dark:bg-white/[.04]" />
      <div className="grid h-full grid-cols-3 place-items-center text-center text-[15px]">
        {[
          ['18', '19', '20'],
          ['сент.', 'окт.', 'нояб.'],
          ['2025', '2026', '2027'],
        ].map((column, index) => (
          <div key={index} className="grid gap-2">
            {column.map((item, itemIndex) => (
              <span key={item} className={itemIndex === 1 ? 'font-semibold' : 'opacity-30'}>{item}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  ),
  'text-editor': () => (
    <div className="mx-4 overflow-hidden rounded-2xl bg-ios-light-surface-1 dark:bg-ios-dark-surface-1">
      <div className="flex gap-1 border-b border-black/[.07] p-2 dark:border-white/[.08]">
        {['B', 'I', 'U', '• List'].map((button) => (
          <button key={button} type="button" className="min-h-8 rounded-lg bg-black/[.05] px-3 text-[13px] font-semibold dark:bg-white/10">
            {button}
          </button>
        ))}
      </div>
      <div className="min-h-24 p-4 text-[15px] text-black/55 outline-none dark:text-white/55" contentEditable suppressContentEditableWarning>
        Описание задачи с форматированием…
      </div>
    </div>
  ),
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
  grid: () => (
    <div className="mx-4 grid grid-cols-2 gap-2">
      {['Проекты', 'Задачи', 'Агенты', 'Файлы'].map((title, index) => (
        <div key={title} className="rounded-2xl bg-ios-light-surface-1 p-4 dark:bg-ios-dark-surface-1">
          <div className="text-[24px] font-bold text-primary">{[4, 18, 3, 27][index]}</div>
          <div className="mt-1 text-[13px] opacity-50">{title}</div>
        </div>
      ))}
    </div>
  ),
  skeleton: () => (
    <div className="mx-4 flex animate-pulse items-center gap-3 rounded-2xl bg-ios-light-surface-1 p-4 dark:bg-ios-dark-surface-1">
      <div className="h-11 w-11 rounded-full bg-black/10 dark:bg-white/10" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-2/3 rounded-full bg-black/10 dark:bg-white/10" />
        <div className="h-3 w-full rounded-full bg-black/[.07] dark:bg-white/[.07]" />
      </div>
    </div>
  ),
  gauge: () => (
    <div className="flex justify-center">
      <div className="grid h-32 w-32 place-items-center rounded-full" style={{ background: 'conic-gradient(#007aff 0 72%, rgba(120,120,128,.18) 72% 100%)' }}>
        <div className="grid h-[104px] w-[104px] place-items-center rounded-full bg-ios-light-surface-2 text-center dark:bg-ios-dark-surface-2">
          <div><div className="text-[25px] font-bold">72%</div><div className="text-[12px] opacity-45">готово</div></div>
        </div>
      </div>
    </div>
  ),
  'pie-chart': () => (
    <div className="flex items-center justify-center gap-5 px-4">
      <div className="h-28 w-28 rounded-full" style={{ background: 'conic-gradient(#007aff 0 42%, #34c759 42% 70%, #d1d1d6 70% 100%)' }} />
      <div className="grid gap-2 text-[12px]">
        {[['#007aff', 'Готово · 42%'], ['#34c759', 'В работе · 28%'], ['#d1d1d6', 'План · 30%']].map(([color, label]) => (
          <div key={label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</div>
        ))}
      </div>
    </div>
  ),
  'area-chart': () => (
    <div className="mx-4 rounded-2xl bg-ios-light-surface-1 p-4 dark:bg-ios-dark-surface-1">
      <div className="mb-2 text-[13px] font-semibold">Токены за неделю</div>
      <svg viewBox="0 0 300 110" className="h-28 w-full" role="img" aria-label="График токенов">
        <defs><linearGradient id="area-blue" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#007aff" stopOpacity=".35" /><stop offset="1" stopColor="#007aff" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 91 L45 71 L90 79 L135 48 L180 36 L225 12 L300 27 L300 110 L0 110 Z" fill="url(#area-blue)" />
        <path d="M0 91 L45 71 L90 79 L135 48 L180 36 L225 12 L300 27" fill="none" stroke="#007aff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ),
  'pull-to-refresh': () => (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/12 text-primary"><RefreshCw size={21} /></span>
      <div className="text-[14px] font-semibold">Потяни вниз для обновления</div>
    </div>
  ),
  'infinite-scroll': () => (
    <div>
      <List strong inset dividers>
        {['Элемент 18', 'Элемент 19', 'Элемент 20'].map((item) => <ListItem key={item} title={item} />)}
      </List>
      <div className="flex justify-center pb-2"><Preloader className="h-5 w-5" /></div>
    </div>
  ),
  'login-screen': () => (
    <div className="mx-4 rounded-2xl bg-ios-light-surface-1 p-4 text-center dark:bg-ios-dark-surface-1">
      <div className="text-[25px] font-bold">aiMe</div>
      <div className="mb-3 text-[13px] opacity-45">Войди в рабочее пространство</div>
      <div className="grid gap-2">
        <div className="rounded-xl bg-black/[.05] px-3 py-2.5 text-left text-[14px] opacity-55 dark:bg-white/[.07]">Email</div>
        <div className="rounded-xl bg-black/[.05] px-3 py-2.5 text-left text-[14px] opacity-55 dark:bg-white/[.07]">Пароль</div>
        <Button rounded>Войти</Button>
      </div>
    </div>
  ),
  'photo-browser': () => (
    <div className="mx-4 overflow-hidden rounded-2xl bg-[#101014] p-3 text-white">
      <div className="aspect-[16/9] rounded-xl bg-gradient-to-br from-[#6dd5ed] via-[#8e7dff] to-[#ff758c]" />
      <div className="mt-2 flex items-center justify-between text-[12px]"><span className="opacity-55">1 из 4</span><span>Скриншот интерфейса</span></div>
    </div>
  ),
  tooltip: () => (
    <div className="flex flex-col items-center py-4">
      <div className="mb-2 rounded-lg bg-black px-3 py-2 text-[12px] text-white dark:bg-white dark:text-black">Здесь можно назначить агента</div>
      <Button rounded outline><HelpCircle size={17} className="mr-1" />Что это?</Button>
    </div>
  ),
}

export { ucastnik }
