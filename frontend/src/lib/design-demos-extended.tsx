import { useState } from 'react'
import {
  Block,
  Button,
  Card,
  Chip,
  List,
  ListInput,
  ListItem,
  Navbar,
  Progressbar,
  Searchbar,
  Segmented,
  SegmentedButton,
  Tabbar,
  TabbarLink,
  Toolbar,
} from 'konsta/react'
import { ArrowLeftRight, Bell, Check, ChevronRight, Home, Search, Settings, User } from 'lucide-react'

type Demo = () => React.ReactNode

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-black/10 bg-ios-light-surface-1 dark:border-white/10 dark:bg-ios-dark-surface-1">
      {children}
    </div>
  )
}

function Slides({ mode = 'horizontal' }: { mode?: string }) {
  const [active, setActive] = useState(0)
  const vertical = mode === 'vertical'
  const slides = ['Один', 'Два', 'Три']
  return (
    <div>
      <div className={`flex gap-2 overflow-auto [scrollbar-width:none] ${vertical ? 'h-44 flex-col snap-y' : 'snap-x'}`}>
        {slides.map((slide, index) => (
          <button
            key={slide}
            type="button"
            onClick={() => setActive(index)}
            className={`grid shrink-0 snap-center place-items-center rounded-2xl p-5 font-semibold transition-all ${
              active === index ? 'bg-primary text-white' : 'bg-black/[.05] dark:bg-white/[.08]'
            } ${vertical ? 'min-h-28 w-full' : mode === 'multiple' ? 'h-28 w-[46%]' : 'h-32 w-[78%]'}`}
          >
            {mode.includes('cube') || mode.includes('flip') ? `${slide} · 3D` : slide}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {slides.map((slide, index) => (
          <button
            key={slide}
            type="button"
            onClick={() => setActive(index)}
            className={`h-1.5 rounded-full ${active === index ? 'w-6 bg-primary' : 'w-1.5 bg-black/20 dark:bg-white/25'}`}
          />
        ))}
      </div>
      {(mode === 'scrollbar' || mode === 'pagination-progress') && (
        <Progressbar className="mt-2" progress={(active + 1) / slides.length} />
      )}
      {mode === 'pagination-fraction' && (
        <div className="mt-2 text-center text-[13px] opacity-55">{active + 1} / {slides.length}</div>
      )}
    </div>
  )
}

function TabsVariant({ mode }: { mode: string }) {
  const [tab, setTab] = useState(0)
  return (
    <Phone>
      <Segmented className="m-3" strong rounded>
        {['Задачи', 'Файлы', 'Люди'].map((label, index) => (
          <SegmentedButton key={label} active={tab === index} onClick={() => setTab(index)}>
            {label}
          </SegmentedButton>
        ))}
      </Segmented>
      <div className={`min-h-28 p-4 ${mode === 'animated' ? 'transition-all duration-300' : ''}`}>
        <b>{['Список задач', 'Файлы проекта', 'Участники'][tab]}</b>
        <p className="mt-1 text-[13px] opacity-55">Вариант: {mode}</p>
      </div>
    </Phone>
  )
}

function PatternDemo({ kind }: { kind: string }) {
  const [on, setOn] = useState(false)
  const [value, setValue] = useState('')

  if (kind.startsWith('swiper-')) return <Slides mode={kind.slice(7)} />
  if (kind.startsWith('tabs-')) return <TabsVariant mode={kind.slice(5)} />

  switch (kind) {
    case 'app':
      return (
        <Phone>
          <Navbar title="aiMe" />
          <Block className="!my-3">Корневой контейнер приложения с темой, роутером и общими настройками.</Block>
        </Phone>
      )
    case 'form':
      return (
        <List strong inset>
          <ListInput label="Название" value={value} onChange={(e) => setValue((e.target as HTMLInputElement).value)} />
          <ListItem title={value.trim() ? 'Форма готова' : 'Заполни обязательное поле'} after={value.trim() ? <Check size={18} className="text-green-500" /> : undefined} />
        </List>
      )
    case 'modal':
      return <Card header="Модальный слой" footer="Popup · Sheet · Dialog · Actions">Контент открывается поверх текущего экрана и удерживает фокус.</Card>
    case 'page':
      return <Phone><Navbar title="Страница" /><Block className="min-h-28 !my-3">Прокручиваемая область одного маршрута.</Block></Phone>
    case 'statusbar':
      return <Phone><div className="flex h-7 items-center justify-between bg-black px-4 text-[11px] text-white"><b>9:41</b><span>● ● ▰</span></div><Navbar title="Под Status Bar" /></Phone>
    case 'touch-highlight':
    case 'touch-ripple':
      return <Button large rounded onPointerDown={() => setOn(true)} onPointerUp={() => setOn(false)} className={on ? '!scale-[.97] !opacity-70' : ''}>{kind === 'touch-ripple' ? 'Нажми — волна' : 'Нажми — подсветка'}</Button>
    case 'typography':
      return <div className="space-y-2"><h1 className="text-[28px] font-bold">Большой заголовок</h1><h2 className="text-[20px] font-semibold">Заголовок секции</h2><p className="text-[15px] leading-relaxed">Основной текст интерфейса с нормальным ритмом и читаемой длиной строки.</p><small className="opacity-50">Вспомогательная подпись</small></div>
    case 'view':
      return <Phone><Navbar title={on ? 'Настройки' : 'Главная'} /><List strong inset><ListItem link title={on ? 'Вернуться' : 'Открыть вложенный экран'} onClick={() => setOn(!on)} after={<ChevronRight size={17} />} /></List></Phone>
    case 'calendar-page':
      return <Phone><Navbar title="Октябрь 2026" /><div className="grid grid-cols-7 gap-1 p-3 text-center text-[13px]">{Array.from({ length: 31 }, (_, i) => <button key={i} className={`aspect-square rounded-full ${i === 4 ? 'bg-primary text-white' : ''}`}>{i + 1}</button>)}</div></Phone>
    case 'cards-expandable':
      return <Card header="Проект aiMe" footer={<Button small clear onClick={() => setOn(!on)}>{on ? 'Свернуть' : 'Развернуть'}</Button>}><div className={`transition-all ${on ? 'min-h-36' : 'max-h-12 overflow-hidden'}`}>Карточка плавно раскрывается в подробный экран. Внутри можно разместить текст, действия и изображения.</div></Card>
    case 'fab-morph':
      return <div className="relative min-h-32 rounded-3xl bg-black/[.04] p-4 dark:bg-white/[.05]"><div className={`absolute transition-all ${on ? 'inset-3 rounded-2xl bg-primary p-4 text-white' : 'bottom-3 right-3 grid h-14 w-14 place-items-center rounded-full bg-primary text-white'}`} onClick={() => setOn(!on)}>{on ? 'Новая задача · нажми, чтобы закрыть' : '+'}</div></div>
    case 'form-storage':
      return <List strong inset><ListInput label="Черновик" placeholder="Сохраняется автоматически" value={value} onChange={(e) => setValue((e.target as HTMLInputElement).value)} /><ListItem title="Статус" after={value ? 'сохранено' : 'пусто'} /></List>
    case 'login-screen-page':
      return <Phone><Navbar title="Вход" /><List strong inset><ListInput label="Почта" type="email" /><ListInput label="Пароль" type="password" /></List><Block><Button large rounded>Войти</Button></Block></Phone>
    case 'navbar-hide-scroll':
      return <Phone><div className={`transition-all ${on ? '-mt-12' : ''}`}><Navbar title="Скрываемая шапка" /></div><Block><Button rounded small onClick={() => setOn(!on)}>{on ? 'Показать при прокрутке вверх' : 'Скрыть при прокрутке вниз'}</Button></Block></Phone>
    case 'searchbar-expandable':
      return <Phone>{on ? <Searchbar value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} onClear={() => setValue('')} /> : <Navbar title="Проекты" right={<Button clear onClick={() => setOn(true)}><Search size={20} /></Button>} />}<Block>{value ? `Ищем: ${value}` : 'Поиск раскрывается из шапки'}</Block></Phone>
    case 'subnavbar-title':
      return <Phone><Navbar title="Проект" subtitle="Подзаголовок под шапкой" /><Toolbar top><div className="px-4 font-semibold">Задачи · 12</div></Toolbar></Phone>
    case 'tabbar-icons':
      return <Phone><div className="min-h-24 p-4">Экран</div><Tabbar labels icons><TabbarLink active label="Главная" icon={<Home size={20} />} /><TabbarLink label="Профиль" icon={<User size={20} />} /></Tabbar></Phone>
    case 'tabbar-scrollable':
      return <div className="flex gap-2 overflow-x-auto rounded-2xl bg-black/[.04] p-2 [scrollbar-width:none] dark:bg-white/[.06]">{['Сегодня', 'Неделя', 'Проекты', 'Команда', 'Архив'].map((x) => <Chip key={x} className="shrink-0">{x}</Chip>)}</div>
    case 'toolbar-hide-scroll':
      return <Phone><Block className="min-h-24">Контент страницы</Block><div className={on ? 'hidden' : ''}><Toolbar><div className="px-4">Нижняя панель</div></Toolbar></div><Block><Button small rounded onClick={() => setOn(!on)}>{on ? 'Показать' : 'Скрыть при скролле'}</Button></Block></Phone>
    case 'color-themes':
      return <div className="flex flex-wrap gap-2">{['#007aff', '#34c759', '#ff9500', '#af52de', '#ff3b30'].map((color) => <button key={color} onClick={() => setValue(color)} style={{ background: color }} className={`h-12 w-12 rounded-full ${value === color ? 'ring-4 ring-black/15 dark:ring-white/20' : ''}`} />)}</div>
    case 'page-transitions':
      return <Phone><div className={`min-h-32 p-4 transition-all duration-300 ${on ? 'translate-x-0 opacity-100' : 'translate-x-3 opacity-80'}`}><b>{on ? 'Второй экран' : 'Первый экран'}</b><Button className="mt-4" rounded onClick={() => setOn(!on)}><ArrowLeftRight size={17} className="mr-1" />Переход</Button></div></Phone>
    case 'routable-modals':
      return <List strong inset><ListItem link title="Popup как маршрут" subtitle="Кнопка Назад закрывает окно" /><ListItem link title="Actions как маршрут" /></List>
    case 'master-detail':
      return <div className="grid grid-cols-[.9fr_1.1fr] overflow-hidden rounded-2xl border border-black/10 dark:border-white/10"><List className="!m-0"><ListItem link title="Проект" onClick={() => setOn(false)} /><ListItem link title="Задача" onClick={() => setOn(true)} /></List><div className="border-l border-black/10 p-4 dark:border-white/10"><b>{on ? 'Детали задачи' : 'Детали проекта'}</b></div></div>
    case 'store':
      return <List strong inset><ListItem title="Уведомления" media={<Bell size={19} />} after="3" /><ListItem title="Профиль" media={<User size={19} />} /><ListItem title="Настройки" media={<Settings size={19} />} /></List>
    default:
      return <Block strong inset>Готовый паттерн Framework7: {kind}</Block>
  }
}

const IDS = [
  'app', 'form', 'modal', 'page', 'statusbar', 'touch-highlight', 'touch-ripple', 'typography', 'view',
  'calendar-page', 'cards-expandable', 'fab-morph', 'form-storage', 'login-screen-page',
  'navbar-hide-scroll', 'searchbar-expandable', 'subnavbar-title',
  'swiper-horizontal', 'swiper-vertical', 'swiper-space-between', 'swiper-multiple', 'swiper-nested',
  'swiper-loop', 'swiper-3d-cube', 'swiper-3d-coverflow', 'swiper-3d-flip', 'swiper-fade',
  'swiper-scrollbar', 'swiper-gallery', 'swiper-parallax', 'swiper-lazy',
  'swiper-pagination-progress', 'swiper-pagination-fraction', 'swiper-zoom',
  'tabs-static', 'tabs-animated', 'tabs-swipeable', 'tabs-routable',
  'tabbar-icons', 'tabbar-scrollable', 'toolbar-hide-scroll', 'color-themes', 'page-transitions',
  'routable-modals', 'master-detail', 'store',
] as const

export const EXTENDED_DEMOS = Object.fromEntries(
  IDS.map((id) => [id, () => <PatternDemo kind={id} />]),
) as Record<(typeof IDS)[number], Demo>
