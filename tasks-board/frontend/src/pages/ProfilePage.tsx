import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder } from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
} from 'konsta/react'
import { useApp } from '../store/AppStore'
import { getUser } from '../lib/telegram'

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

  return (
    <Page>
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
            <div className="text-white text-[24px] font-semibold">
              {fullName}
            </div>
            {user?.username && (
              <div className="text-white/60 text-[15px] mt-0.5">
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
          <p className="text-white/60 text-[15px]">
            Открой миниаппу из бота — там будут твои Telegram-данные.
          </p>
        </Block>
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
    <div className="bg-white/[.06] rounded-2xl px-3 py-3 text-center">
      <div
        className="text-[24px] font-bold"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="text-white/60 text-[12px] mt-0.5">{label}</div>
    </div>
  )
}
