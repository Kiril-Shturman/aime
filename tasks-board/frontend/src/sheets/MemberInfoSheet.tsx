import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
  Segmented,
  SegmentedButton,
} from 'konsta/react'
import Popup from '../components/Popup'
import { Avatar } from '../components/Avatar'
import MemberConnect from '../components/MemberConnect'
import BotConnect from '../components/BotConnect'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { KINDS, kindLabel, TASK_STATUS_LABEL } from '../lib/constants'
import type { Member, MemberJob, MemberKind } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  member: Member | null
}

export default function MemberInfoSheet({
  open,
  onClose,
  projectId,
  member,
}: Props) {
  const { state, refresh } = useApp()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [handle, setHandle] = useState('')
  const [kind, setKind] = useState<MemberKind>('bot')
  const [job, setJob] = useState<MemberJob>('work')
  const [pozvano, setPozvano] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)

  useEffect(() => {
    if (!member) return
    setName(member.name ?? '')
    setRole(member.role ?? '')
    setHandle(member.handle ?? '')
    setKind(member.kind ?? 'bot')
    setJob(member.job ?? 'work')
  }, [member])

  if (!member) return null

  // «в сети», если участник выходил на связь недавно: доска отмечает
  // каждое его обращение по ключу
  const vterin = member.seen ? Math.floor(Date.now() / 1000 - member.seen) : null
  const naSviazi = vterin !== null && vterin < 300
  const stavSpojeni =
    vterin === null
      ? 'ещё не подключался'
      : naSviazi
        ? 'в сети'
        : vterin < 3600
          ? `был ${Math.max(1, Math.floor(vterin / 60))} мин назад`
          : vterin < 86400
            ? `был ${Math.floor(vterin / 3600)} ч назад`
            : `был ${Math.floor(vterin / 86400)} дн назад`

  const own = state?.tasks.filter((t) => t.member === member.id) ?? []
  const done = own.filter((t) => t.done)
  const tokens = own.reduce((s, t) => s + (t.tokens ?? 0), 0)

  // расход за последние семь дней: по задачам, которые агент в это время вёл
  const tyden = Date.now() - 7 * 86400000
  const cerstve = own.filter((t) => {
    const kdy = t.started_at ?? t.done_at
    return kdy ? new Date(kdy).getTime() >= tyden : false
  })
  const tokenyTyden = cerstve.reduce((s, t) => s + (t.tokens ?? 0), 0)
  const sekundyTyden = cerstve.reduce((s, t) => s + (t.seconds ?? 0), 0)
  const cas = sekundyTyden >= 3600
    ? `${(sekundyTyden / 3600).toFixed(1)} ч`
    : sekundyTyden >= 60
      ? `${Math.round(sekundyTyden / 60)} мин`
      : sekundyTyden
        ? `${sekundyTyden} с`
        : '—'

  // Агент доски лежит не в проекте, а рядом: его правим и открепляем
  // через /api/agents/<id>, иначе доска отвечает «нет такого участника».
  const obecny = (state?.agents ?? []).find((a) => a.id === member.id) ?? null
  const jeObecny = !!obecny

  const pozvat = async () => {
    haptic('success')
    setPozvano(true)
    try {
      if (jeObecny) await api.pingAgent(member.id)
      else await api.pingMember(projectId, member.id)
      await refresh()
    } catch (e) {
      setPozvano(false)
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
    window.setTimeout(() => setPozvano(false), 4000)
  }

  const save = async () => {
    try {
      if (obecny) {
        await api.patchAgent(obecny.id, {
          name: name.trim(),
          role: role.trim() || undefined,
          job,
          project: projectId,
        })
      } else {
        await api.patchMember(projectId, member.id, {
          name: name.trim(),
          role: role.trim() || undefined,
          handle: handle.trim() || undefined,
          kind,
          job,
        })
      }
      haptic('success')
      onClose()
      await refresh()
    } catch (e) {
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
  }

  const remove = async () => {
    const otazka = obecny
      ? 'Убрать агента из проекта? На доске он останется.'
      : 'Убрать участника из проекта? Его задачи останутся.'
    if (!confirm(otazka)) return
    try {
      if (obecny) {
        await api.patchAgent(obecny.id, {
          projects: (obecny.projects ?? []).filter((x) => x !== projectId),
        })
      } else {
        await api.deleteMember(projectId, member.id)
      }
      onClose()
      await refresh()
    } catch (e) {
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
  }

  return (
    <Popup
      open={open}
      onClose={onClose}
      title={member.name}
      onSave={save}
      canSave={!!name.trim()}
    >
      <Block className="!mt-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="relative">
            <Avatar member={member} size={56} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-ios-dark-surface-1 ${
                naSviazi ? 'bg-white' : 'bg-white/25'
              }`}
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[19px] font-semibold text-black dark:text-white">
              {member.name}
            </div>
            <div className="truncate text-[13px] text-black/55 dark:text-white/45">
              {member.role || kindLabel(member.kind)} · {stavSpojeni}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat title="в работе" value={String(own.length - done.length)} />
          <Stat title="закрыто" value={String(done.length)} />
          <Stat title="токенов" value={tokens ? String(tokens) : '—'} />
        </div>

        {(member.model || member.client) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {member.model && <Stat title="модель" value={member.model} small />}
            {member.client && <Stat title="подключён" value={member.client} small />}
          </div>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat title="токенов за неделю" value={tokenyTyden ? fmtNum(tokenyTyden) : '—'} small />
          <Stat title="времени за неделю" value={cas} small />
        </div>

        {member.kind === 'agent' && (
          <button
            type="button"
            onClick={pozvat}
            className="mt-3 w-full rounded-2xl border border-black/[.06] bg-ios-light-surface-1 py-3 dark:border-white/[.08] text-[15px] font-semibold text-black active:opacity-70 dark:text-white dark:bg-ios-dark-surface-1"
          >
            {pozvano ? 'Позвали — ждём' : 'Позвать агента'}
          </button>
        )}

        {chyba && (
          <p className="mt-2 text-[13px] leading-snug text-[#ff9f0a]">{chyba}</p>
        )}

        {member.ping && !pozvano ? (
          <p className="mt-2 text-[13px] leading-snug text-black/45 dark:text-white/40">
            Последний раз звали {new Date(member.ping * 1000).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}. Агент увидит это, когда придёт за задачами.
          </p>
        ) : null}
      </Block>

      {kind === 'bot' ? (
        <BotConnect projectId={projectId} member={member} />
      ) : (
        <MemberConnect member={member} />
      )}

      <BlockTitle>Кто это</BlockTitle>
      <Block>
        <Segmented strong rounded>
          {KINDS.filter((k) => k.id === 'agent' || k.id === 'human').map((k) => (
            <SegmentedButton
              key={k.id}
              active={kind === k.id}
              onClick={() => setKind(k.id as MemberKind)}
              className="!text-[14px] whitespace-nowrap"
            >
              {k.label}
            </SegmentedButton>
          ))}
        </Segmented>
      </Block>

      <BlockTitle>Что делает в проекте</BlockTitle>
      <Block>
        <Segmented strong rounded>
          <SegmentedButton
            active={job === 'work'}
            onClick={() => setJob('work')}
            className="!text-[14px] whitespace-nowrap"
          >
            Исполнитель
          </SegmentedButton>
          <SegmentedButton
            active={job === 'check'}
            onClick={() => setJob('check')}
            className="!text-[14px] whitespace-nowrap"
          >
            Проверяющий
          </SegmentedButton>
        </Segmented>
        <p className="mt-2 text-[13px] leading-snug text-black/55 dark:text-white/45">
          {job === 'check'
            ? 'Задачи этого проекта не закрываются сразу: исполнитель сдаёт работу, а он смотрит результат — открывает страницу, снимает скрин — и пишет «принято» или что переделать.'
            : 'Берёт задачи и отчитывается. Если в проекте есть проверяющий, его работа уходит сначала к нему.'}
        </p>
      </Block>

      <List strong inset>
        <ListInput
          label="Имя"
          type="text"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="Роль"
          type="text"
          value={role}
          onChange={(e) => setRole((e.target as HTMLInputElement).value)}
        />
        <ListInput
          label="@username"
          type="text"
          value={handle}
          onChange={(e) => setHandle((e.target as HTMLInputElement).value)}
        />
      </List>

      {own.length > 0 && (
        <>
          <BlockTitle>Задачи участника</BlockTitle>
          <List strong inset>
            {own.slice(0, 6).map((t) => (
              <ListItem
                key={t.id}
                title={t.title}
                subtitle={TASK_STATUS_LABEL[t.status]}
              />
            ))}
          </List>
        </>
      )}

      <Block>
        <Button
          large
          rounded
          clear
          colors={{
            textIos: 'text-red-500',
            textMaterial: 'text-red-500',
            clearBgIos: 'bg-transparent active:bg-red-500/15',
            clearBgMaterial: 'bg-transparent',
          }}
          onClick={remove}
        >
          <Trash2 size={18} className="mr-2" /> Убрать из проекта
        </Button>
      </Block>
    </Popup>
  )
}

function fmtNum(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function Stat({ title, value, small }: { title: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-black/[.06] bg-ios-light-surface-1 px-3 py-3 dark:border-white/[.08] dark:bg-ios-dark-surface-1">
      <div className={`${small ? 'truncate text-[15px]' : 'text-[20px]'} font-bold`}>{value}</div>
      <div className="mt-0.5 text-[12px] opacity-60">{title}</div>
    </div>
  )
}
