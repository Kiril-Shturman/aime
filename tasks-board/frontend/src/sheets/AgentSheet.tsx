import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { Block, Button, List, ListInput, ListItem, Segmented, SegmentedButton } from 'konsta/react'
import Popup from '../components/Popup'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { SPOSOBY, recept } from '../lib/connect'
import type { Agent } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  agent?: Agent | null
  onOpenChat?: (agent: Agent) => void
}

// Агент живёт на доске, а не внутри проекта: здесь его заводят, подключают
// и отмечают галочками, в каких проектах он участвует.
export default function AgentSheet({ open, onClose, agent, onOpenChat }: Props) {
  const { state, refresh } = useApp()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [vProjektech, setVProjektech] = useState<string[]>([])
  const [hotovy, setHotovy] = useState<Agent | null>(null)
  const [sposob, setSposob] = useState<string>('promt')
  const [zkopirovano, setZkopirovano] = useState(false)
  const [pozvano, setPozvano] = useState(false)
  const [hook, setHook] = useState('')
  const [doruceno, setDoruceno] = useState<string | null>(null)
  const [chyba, setChyba] = useState<string | null>(null)
  const [poprosili, setPoprosili] = useState(false)


  const zobrazeny = agent ?? hotovy

  useEffect(() => {
    if (!open) return
    setName(agent?.name ?? '')
    setRole(agent?.role ?? '')
    setHook(agent?.hook ?? '')
    setDoruceno(null)
    setVProjektech(agent?.projects ?? [])
    setHotovy(null)
    setChyba(null)
    setSposob('promt')
  }, [open, agent])

  const stav = useMemo(() => {
    const vterin = zobrazeny?.seen ? Math.floor(Date.now() / 1000 - zobrazeny.seen) : null
    if (vterin === null) return { text: 'ещё не подключался', online: false }
    if (vterin < 300) return { text: 'в сети', online: true }
    if (vterin < 3600) return { text: `был ${Math.max(1, Math.floor(vterin / 60))} мин назад`, online: false }
    if (vterin < 86400) return { text: `был ${Math.floor(vterin / 3600)} ч назад`, online: false }
    return { text: `был ${Math.floor(vterin / 86400)} дн назад`, online: false }
  }, [zobrazeny?.seen])

  const prepnoutProjekt = async (pid: string) => {
    const dalsi = vProjektech.includes(pid)
      ? vProjektech.filter((x) => x !== pid)
      : [...vProjektech, pid]
    setVProjektech(dalsi)
    haptic('light')
    if (zobrazeny) {
      await api.patchAgent(zobrazeny.id, { projects: dalsi })
      await refresh()
    }
  }

  const ulozit = async () => {
    if (!name.trim()) return
    try {
      if (agent) {
        await api.patchAgent(agent.id, {
          name: name.trim(),
          role: role.trim(),
          hook: hook.trim(),
          projects: vProjektech,
        })
        haptic('success')
        await refresh()
        onClose()
        return
      }
      const novy = (await api.addAgent({
        name: name.trim(),
        role: role.trim() || undefined,
        projects: vProjektech,
      })) as Agent
      haptic('success')
      await refresh()
      setHotovy(novy)
    } catch (e) {
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
  }

  // просим агента прислать, чего доска сама не узнает: аккаунт, тариф, лимиты
  const poprosit = async () => {
    if (!zobrazeny) return
    haptic('light')
    setPoprosili(true)
    const prikaz = `Пришли доске свои данные — аккаунт, тариф и остаток лимита:
curl -X POST ${location.origin}/api/agent/connect \\
  -H "X-Board-Key: ${zobrazeny.key ?? '<твой ключ>'}" -H "Content-Type: application/json" \\
  -d '{"account":"<почта аккаунта>","plan":"<тариф>","plan_until":"<до какого дня>",
       "limits":{"5 часов":{"used":0,"limit":0,"reset":"чч:мм"},
                  "неделя":{"used":0,"limit":0,"reset":"пн"}}}'
Цифры возьми из /usage (Claude Code, OpenClaw), из заголовков anthropic-ratelimit-* или из /api/v1/key у OpenRouter.`
    try {
      await api.sayToAgent(zobrazeny.id, prikaz)
      await refresh()
    } catch {
      setPoprosili(false)
    }
    window.setTimeout(() => setPoprosili(false), 6000)
  }

  const pozvat = async () => {
    if (!zobrazeny) return
    haptic('success')
    setPozvano(true)
    try {
      const r = await api.pingAgent(zobrazeny.id)
      setDoruceno(
        r.hook
          ? r.hook.delivered
            ? 'Достучались — агент разбужен'
            : `Не достучались: ${r.hook.note}`
          : 'Адреса нет — увидит, когда придёт за задачами',
      )
      await refresh()
    } catch {
      setPozvano(false)
    }
    window.setTimeout(() => setPozvano(false), 4000)
  }

  const smazat = async () => {
    if (!agent) return
    if (!confirm('Убрать агента с доски? Его задачи останутся.')) return
    await api.deleteAgent(agent.id)
    onClose()
    await refresh()
  }

  const text = zobrazeny
    ? recept(sposob, location.origin, zobrazeny.key ?? '', zobrazeny.name, zobrazeny.role)
    : ''

  const kopirovat = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(text)
      setZkopirovano(true)
      window.setTimeout(() => setZkopirovano(false), 1500)
    } catch {
      /* без буфера — выделит руками */
    }
  }

  return (
    <Popup
      open={open}
      onClose={onClose}
      title={agent ? agent.name : hotovy ? 'Подключение агента' : 'Новый агент'}
      onSave={hotovy ? undefined : ulozit}
      canSave={!!name.trim()}
    >
      {zobrazeny && (
        <Block className="!mt-4 !mb-0">
          <div className="flex items-center gap-2 text-[15px]">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                stav.online ? 'bg-black dark:bg-white' : 'bg-black/25 dark:bg-white/25'
              }`}
            />
            <span className="text-black/70 dark:text-white/60">{stav.text}</span>
            {zobrazeny.model && (
              <span className="ml-auto truncate text-black/45 dark:text-white/40">
                {zobrazeny.model}
              </span>
            )}
          </div>

          <Limity limits={zobrazeny.limits} />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Udaj nazev="модель" hodnota={zobrazeny.model} />
            <Udaj nazev="аккаунт" hodnota={zobrazeny.account} />
            <Udaj nazev="подписка" hodnota={zobrazeny.plan} />
            <Udaj
              nazev="оплачено до"
              hodnota={
                zobrazeny.plan_until
                  ? new Date(zobrazeny.plan_until).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                    })
                  : undefined
              }
            />
            <Udaj nazev="расход" hodnota={zobrazeny.usage} />
            <Udaj nazev="чем подключён" hodnota={zobrazeny.client} />
          </div>

          {!zobrazeny.account && !zobrazeny.plan && !zobrazeny.limits && (
            <div className="mt-3 rounded-xl border border-black/[.06] bg-ios-light-surface-1 px-3 py-3 dark:border-white/[.08] dark:bg-ios-dark-surface-1">
              <p className="text-[13px] leading-snug text-black/55 dark:text-white/45">
                Аккаунт, подписку и остаток лимита доска сама не видит — это знает только
                клиент агента. Попросите его прислать: он ответит одной командой.
              </p>
              <button
                type="button"
                onClick={poprosit}
                className="mt-2.5 text-[15px] font-semibold text-black active:opacity-60 dark:text-white"
              >
                {poprosili ? 'Попросили — ждём ответа' : 'Запросить данные'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => zobrazeny && onOpenChat?.(zobrazeny)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-black/[.06] bg-ios-light-surface-1 py-3 text-[15px] font-semibold text-black active:opacity-70 dark:border-white/[.08] dark:bg-ios-dark-surface-1 dark:text-white"
          >
            <MessageCircle size={18} />
            Открыть чат с агентом
          </button>
        </Block>
      )}

      {!hotovy && (
        <List strong inset>
          <ListInput
            label="Имя"
            type="text"
            placeholder="Например, Разработчик"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <ListInput
            label="Роль"
            type="text"
            placeholder="Что делает: пишет код, смотрит метрики"
            value={role}
            onChange={(e) => setRole((e.target as HTMLInputElement).value)}
          />
          <ListInput
            label="Адрес для вызова (если есть)"
            type="text"
            placeholder="Обычно не нужен: агент слушает сам"
            value={hook}
            onChange={(e) => setHook((e.target as HTMLInputElement).value)}
          />
        </List>
      )}

      {/* закрепление за проектами: просто галочки */}
      <Block className="!mb-1 !mt-5">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
          В каких проектах работает
        </p>
      </Block>
      <List strong inset>
        {(state?.projects ?? []).map((p) => (
          <ListItem
            key={p.id}
            link
            onClick={() => prepnoutProjekt(p.id)}
            title={p.name}
            after={
              vProjektech.includes(p.id) ? (
                <Check size={18} className="text-black dark:text-white" />
              ) : (
                <span className="text-[13px] text-black/30 dark:text-white/25">нет</span>
              )
            }
          />
        ))}
      </List>

      {chyba && (
        <Block className="!mt-0">
          <p className="text-[14px] leading-snug text-[#ff9f0a]">{chyba}</p>
        </Block>
      )}

      {zobrazeny && (
        <>
          <Block className="!mb-1 !mt-5">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              Чем подключаем
            </p>
          </Block>
          <Block className="!mt-0">
            <Segmented strong rounded>
              {SPOSOBY.map((s) => (
                <SegmentedButton
                  key={s.id}
                  active={sposob === s.id}
                  onClick={() => setSposob(s.id)}
                  className="!text-[14px] whitespace-nowrap"
                >
                  {s.label}
                </SegmentedButton>
              ))}
            </Segmented>

            <div className="relative mt-3">
              <pre className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-black/[.06] bg-ios-light-surface-1 p-3 pr-11 dark:border-white/[.08] text-[12px] leading-snug text-black/80 dark:bg-ios-dark-surface-1 dark:text-white/80">
                {text}
              </pre>
              <button
                onClick={kopirovat}
                className="absolute right-2 top-2 rounded-full bg-black/10 p-2 text-black/70 dark:bg-white/10 dark:text-white/70"
                aria-label="Скопировать"
              >
                {zkopirovano ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </Block>

          <Block className="grid gap-2">
            <p className="text-[13px] leading-snug text-black/45 dark:text-white/40">
              {zobrazeny.hook
                ? 'Позвать — доска постучится по адресу агента и разбудит его.'
                : 'Позвать — агент проснётся на своём ожидании (board_wait) или увидит вызов, когда придёт за задачами.'}
            </p>
            {doruceno && (
              <p className="text-[13px] leading-snug text-black/55 dark:text-white/45">{doruceno}</p>
            )}
            <button
              type="button"
              onClick={pozvat}
              className="w-full rounded-2xl border border-black/[.06] bg-ios-light-surface-1 py-3 dark:border-white/[.08] text-[15px] font-semibold text-black active:opacity-70 dark:text-white dark:bg-ios-dark-surface-1"
            >
              {pozvano ? 'Позвали — ждём' : 'Позвать агента'}
            </button>
            {agent && (
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
                onClick={smazat}
              >
                Убрать с доски
              </Button>
            )}
          </Block>
        </>
      )}
    </Popup>
  )
}

// Остатки по окнам лимита: агент присылает их сам — доска у провайдера
// их не спросит. Формат: { "5 часов": {used, limit, reset}, "неделя": {…} }
function Limity({ limits }: { limits?: string }) {
  if (!limits) return null
  let data: Record<string, { used?: number; limit?: number; reset?: string }>
  try {
    data = JSON.parse(limits)
  } catch {
    return null
  }
  const polozky = Object.entries(data)
  if (!polozky.length) return null

  const cislo = (n?: number) =>
    n === undefined ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

  return (
    <div className="mt-3 grid gap-2">
      {polozky.map(([okno, v]) => {
        const podil = v.limit ? Math.min(1, (v.used ?? 0) / v.limit) : 0
        const zbyva = v.limit ? Math.max(0, v.limit - (v.used ?? 0)) : undefined
        return (
          <div
            key={okno}
            className="rounded-xl border border-black/[.06] bg-ios-light-surface-1 px-3 py-2.5 dark:border-white/[.08] dark:bg-ios-dark-surface-1"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold text-black dark:text-white">
                {zbyva !== undefined ? `осталось ${cislo(zbyva)}` : cislo(v.used)}
              </span>
              <span className="text-[12px] text-black/45 dark:text-white/40">
                {okno}
                {v.reset ? ` · сброс ${v.reset}` : ''}
              </span>
            </div>
            {v.limit ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/12">
                <div
                  className="h-full rounded-full bg-black dark:bg-white"
                  style={{ width: `${Math.round(podil * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function Udaj({ nazev, hodnota }: { nazev: string; hodnota?: string }) {
  return (
    <div className="rounded-xl border border-black/[.06] bg-ios-light-surface-1 px-3 py-2.5 dark:border-white/[.08] dark:bg-ios-dark-surface-1">
      <div className="truncate text-[15px] font-semibold text-black dark:text-white">
        {hodnota || '—'}
      </div>
      <div className="mt-0.5 text-[12px] text-black/45 dark:text-white/40">{nazev}</div>
    </div>
  )
}
