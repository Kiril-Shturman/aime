import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder, Plus, Trash2 } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Toggle,
} from 'konsta/react'
import { useApp } from '../store/AppStore'
import { useTheme } from '../store/ThemeStore'
import { getUser, haptic } from '../lib/telegram'
import { api } from '../api/client'
import type { Assistant } from '../api/types'
import Pill from '../components/Pill'
import BoardAccess from '../components/BoardAccess'
import DmAccount from '../components/DmAccount'
import PickerSheet from '../sheets/PickerSheet'
import TextSheet from '../sheets/TextSheet'

// какое поле сейчас правим текстом
type Field = 'autoreply' | 'hours' | 'sla' | 'escalate' | 'reply' | null

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = getUser()
  const { state } = useApp()

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Гость'
  const letter = fullName.trim().charAt(0).toUpperCase() || '?'

  const stats = useMemo(() => {
    if (!state) return { open: 0, done: 0, projects: 0, doing: 0 }
    return {
      open: state.tasks.filter((t) => !t.done).length,
      done: state.tasks.filter((t) => t.done).length,
      doing: state.tasks.filter((t) => t.status === 'doing').length,
      projects: state.projects.length,
    }
  }, [state])

  const projects = state?.projects ?? []

  // настройки бота, который висит в личке
  const [bot, setBot] = useState<Assistant | null>(null)
  const [modePick, setModePick] = useState(false)
  const [field, setField] = useState<Field>(null)

  const loadBot = useCallback(() => {
    api.getAssistant().then(setBot).catch(() => setBot(null))
  }, [])
  useEffect(loadBot, [loadBot])

  const patch = async (p: Partial<Assistant>) => {
    haptic('light')
    setBot(await api.patchAssistant(p))
  }

  const FIELDS = {
    autoreply: {
      title: 'Автоответ',
      label: 'Что написать, пока меня нет',
      value: bot?.autoreply.text ?? '',
      multiline: true,
      save: (v: string) => patch({ autoreply: { ...bot!.autoreply, text: v, on: true } }),
    },
    hours: {
      title: 'Часы работы',
      label: 'Например, 10:00–19:00',
      value: bot?.support.hours ?? '',
      multiline: false,
      save: (v: string) => patch({ support: { ...bot!.support, hours: v } }),
    },
    sla: {
      title: 'Отвечать за',
      label: 'Минут на первый ответ',
      value: bot?.support.sla ? String(bot.support.sla) : '',
      multiline: false,
      save: (v: string) =>
        patch({ support: { ...bot!.support, sla: Number(v) || 0 } }),
    },
    escalate: {
      title: 'Кому передавать',
      label: 'Ник того, кто разберётся',
      value: bot?.support.escalate ?? '',
      multiline: false,
      save: (v: string) => patch({ support: { ...bot!.support, escalate: v } }),
    },
    reply: {
      title: 'Новая заготовка',
      label: 'Текст, который бот вставит',
      value: '',
      multiline: true,
      save: async (v: string) => {
        if (!v) return
        await api.addReply('', v)
        loadBot()
      },
    },
  } as const

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Профиль"
        left={<NavbarBackLink text="Задачи" onClick={() => navigate('/')} />}
      />

      <Block className="!mt-4 !mb-4">
        <div className="flex flex-col items-center gap-3">
          {user?.photo_url ? (
            <img
              src={user.photo_url}
              alt=""
              className="w-24 h-24 rounded-full object-cover"
            />
          ) : (
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-[#2a8bff] text-white text-[40px] font-semibold">
              {letter}
            </div>
          )}
          <div className="text-center">
            <div className="text-black dark:text-white text-[24px] font-semibold">
              {fullName}
            </div>
            {user?.username && (
              <div className="text-black/60 dark:text-white/60 text-[15px] mt-0.5">
                @{user.username}
              </div>
            )}
            {user?.is_premium && (
              <div className="inline-block mt-2 text-[12px] px-2 py-0.5 rounded-full bg-[#ffd60a]/20 text-[#ffd60a]">
                Telegram Premium
              </div>
            )}
          </div>
        </div>
      </Block>

      <Block>
        <div className="grid grid-cols-4 gap-2">
          <Stat value={stats.projects} label="проектов" />
          <Stat value={stats.open} label="в работе" />
          <Stat value={stats.doing} label="сейчас" accent="#4ea3ff" />
          <Stat value={stats.done} label="закрыто" />
        </div>
      </Block>

      {projects.length > 0 && (
        <>
          <BlockTitle>Проекты</BlockTitle>
          <List strong inset>
            {projects.map((p) => (
              <ListItem
                key={p.id}
                chevron
                onClick={() => navigate(`/project/${p.id}`)}
                title={p.name}
                subtitle={
                  p.members.length > 0
                    ? `${p.members.length} чел.`
                    : 'без команды'
                }
                media={
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-full text-white shrink-0"
                    style={{ background: p.color ?? '#2a8bff' }}
                  >
                    <Folder size={16} />
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}

      {bot && (
        <>
          <BoardAccess />

          <DmAccount />

          <BlockTitle>Бот в личке</BlockTitle>
          <List strong inset>
            <ListItem
              title="Подключение"
              subtitle={
                bot.business.connected
                  ? `Читает личку ${bot.business.account}`
                  : 'Личка не подключена'
              }
              after={
                <Pill tone={bot.business.connected ? 'work' : 'free'}>
                  {bot.business.connected ? 'на связи' : 'нет'}
                </Pill>
              }
            />
            <ListItem
              link
              title="Зачем он там"
              after={bot.mode === 'support' ? 'Поддержка' : 'Личка'}
              onClick={() => setModePick(true)}
            />
          </List>

          <BlockTitle>Что делает</BlockTitle>
          <List strong inset>
            <ListItem
              link
              title="Автоответ"
              subtitle={bot.autoreply.text || 'Текст не задан'}
              onClick={() => setField('autoreply')}
              after={
                <Toggle
                  checked={bot.autoreply.on}
                  onChange={() =>
                    patch({ autoreply: { ...bot.autoreply, on: !bot.autoreply.on } })
                  }
                />
              }
            />
            <ListItem
              title="Показывать удалённые"
              subtitle="Если собеседник стёр сообщение"
              after={
                <Toggle
                  checked={bot.watch.deleted}
                  onChange={() =>
                    patch({ watch: { ...bot.watch, deleted: !bot.watch.deleted } })
                  }
                />
              }
            />
            <ListItem
              title="Показывать правки"
              subtitle="Что было в сообщении до изменения"
              after={
                <Toggle
                  checked={bot.watch.edited}
                  onChange={() =>
                    patch({ watch: { ...bot.watch, edited: !bot.watch.edited } })
                  }
                />
              }
            />
            <ListItem
              title="Сводка за день"
              subtitle={`Кто писал и кому не ответил, в ${bot.digest.at}`}
              after={
                <Toggle
                  checked={bot.digest.on}
                  onChange={() =>
                    patch({ digest: { ...bot.digest, on: !bot.digest.on } })
                  }
                />
              }
            />
          </List>

          {bot.mode === 'support' && (
            <>
              <BlockTitle>Поддержка</BlockTitle>
              <List strong inset>
                <ListItem
                  link
                  title="Часы работы"
                  after={bot.support.hours || 'круглосуточно'}
                  onClick={() => setField('hours')}
                />
                <ListItem
                  link
                  title="Отвечать за"
                  after={bot.support.sla ? `${bot.support.sla} мин` : 'без срока'}
                  onClick={() => setField('sla')}
                />
                <ListItem
                  link
                  title="Кому передавать"
                  after={bot.support.escalate || 'никому'}
                  onClick={() => setField('escalate')}
                />
              </List>
            </>
          )}

          <BlockTitle>Заготовки</BlockTitle>
          <List strong inset dividers>
            {bot.replies.map((r) => (
              <ListItem
                key={r.id}
                title={r.title}
                subtitle={r.text}
                after={
                  <button
                    className="p-2 -mr-2 text-black/45 dark:text-white/35"
                    onClick={async (e) => {
                      e.stopPropagation()
                      haptic('light')
                      await api.deleteReply(r.id)
                      loadBot()
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                }
              />
            ))}
            <ListItem
              link
              title="Добавить заготовку"
              media={<Plus size={20} className="text-[#2a8bff]" />}
              onClick={() => setField('reply')}
            />
          </List>

          {!bot.business.connected && (
            <Block>
              <p className="text-black/55 dark:text-white/45 text-[14px] leading-snug">
                Пока бот в личку не подключён, настройки просто хранятся.
                Подключается он в Телеграме: Настройки → Telegram для бизнеса →
                Чат-боты. Нужен Премиум.
              </p>
            </Block>
          )}
        </>
      )}

      <BlockTitle>Оформление</BlockTitle>
      <List strong inset>
        <ThemeRow />
      </List>

      {user && (
        <>
          <BlockTitle>Данные Telegram</BlockTitle>
          <List strong inset>
            <ListItem title="ID" after={String(user.id)} />
            {user.language_code && (
              <ListItem title="Язык" after={user.language_code} />
            )}
          </List>
        </>
      )}

      {!user && (
        <Block>
          <p className="text-black/60 dark:text-white/60 text-[15px]">
            Открой миниаппу из бота — там будут твои Telegram-данные.
          </p>
        </Block>
      )}
      <PickerSheet
        open={modePick}
        onClose={() => setModePick(false)}
        title="Зачем он в личке"
        allowClear={false}
        value={bot?.mode ?? 'personal'}
        options={[
          { id: 'personal', label: 'Личка', sub: 'Мой помощник в переписке' },
          { id: 'support', label: 'Поддержка', sub: 'Отвечает клиентам вместо меня' },
        ]}
        onPick={(id) => patch({ mode: (id as Assistant['mode']) ?? 'personal' })}
      />

      {field && (
        <TextSheet
          open
          onClose={() => setField(null)}
          title={FIELDS[field].title}
          label={FIELDS[field].label}
          value={FIELDS[field].value}
          multiline={FIELDS[field].multiline}
          onSave={FIELDS[field].save}
        />
      )}

    </Page>
  )
}

function Stat({
  value,
  label,
  accent,
}: {
  value: number
  label: string
  accent?: string
}) {
  return (
    <div className="bg-black/[.05] dark:bg-white/[.06] rounded-2xl px-3 py-3 text-center">
      <div
        className="text-[24px] font-bold"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="text-black/60 dark:text-white/60 text-[12px] mt-0.5">{label}</div>
    </div>
  )
}

function ThemeRow() {
  const { theme, toggle } = useTheme()
  return (
    <ListItem
      title="Тёмная тема"
      after={<Toggle checked={theme === 'dark'} onChange={toggle} />}
    />
  )
}
