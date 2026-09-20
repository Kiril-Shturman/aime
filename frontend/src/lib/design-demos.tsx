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
  MoreHorizontal,
  Plus,
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
}

export { ucastnik }
