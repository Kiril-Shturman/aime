import { useState } from 'react'
import { BadgeCheck, Link2, Unplug } from 'lucide-react'
import { Block, BlockTitle, Button, List, ListInput, ListItem } from 'konsta/react'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import type { Member } from '../api/types'

// Управление живым телеграм-ботом. Ссылка t.me/бот запоминает только имя —
// командовать ботом можно исключительно с токеном от BotFather, других
// способов Телеграм не даёт. Токен уезжает на сервер и обратно не возвращается.
export default function BotConnect({
  projectId,
  member,
}: {
  projectId: string
  member: Member
}) {
  const { refresh } = useApp()
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const bot = member.bot

  const clean = (e: unknown) =>
    String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, '')

  const connect = async () => {
    if (!ref.trim() || busy) return
    setBusy(true)
    setNote('')
    try {
      const out = await api.connectBot(projectId, member.id, ref.trim())
      haptic('success')
      setRef('')
      setNote(out.hint ?? `Готово: @${out.bot?.username} слушается доски.`)
      await refresh()
    } catch (e) {
      haptic('error')
      setNote(clean(e))
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    setBusy(true)
    try {
      const out = (await api.callBot(member.id, 'getMe')) as {
        result: { username: string }
      }
      haptic('success')
      setNote(`Отвечает: @${out.result.username}`)
    } catch (e) {
      haptic('error')
      setNote(clean(e))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Отключить бота? Доска забудет токен, сам бот продолжит работать.'))
      return
    await api.disconnectBot(projectId, member.id)
    haptic('medium')
    setNote('')
    await refresh()
  }

  return (
    <>
      <BlockTitle>Управление ботом</BlockTitle>

      {bot?.connected ? (
        <>
          <List strong inset>
            <ListItem
              title={`@${bot.username}`}
              subtitle={bot.name || 'Подключён'}
              media={<BadgeCheck size={20} className="text-[#30d158]" />}
              after={String(bot.bot_id ?? '')}
            />
            <ListItem link title="Проверить связь" onClick={check} />
            <ListItem
              link
              title="Отключить"
              media={<Unplug size={18} className="text-red-500" />}
              onClick={disconnect}
            />
          </List>
          <Block>
            <p className="text-white/45 text-[14px] leading-snug">
              Теперь агенту можно сказать словами: «напиши от {member.name} в чат
              такой-то» — он сходит через доску. Входящие доска не читает: их
              забирает сам бот, и отнимать их нельзя.
            </p>
          </Block>
        </>
      ) : (
        <>
          <List strong inset>
            <ListInput
              label="Ссылка или токен"
              type="text"
              placeholder="t.me/MyBot или 12345:AA…"
              value={ref}
              onChange={(e) => setRef((e.target as HTMLInputElement).value)}
              media={<Link2 size={20} className="text-[#2a8bff]" />}
            />
          </List>
          <Block>
            <Button large rounded onClick={connect} disabled={busy || !ref.trim()}>
              {busy ? 'Проверяю…' : 'Подключить'}
            </Button>
            <p className="text-white/45 text-[14px] leading-snug mt-3">
              Ссылка запомнит имя бота. Чтобы им можно было управлять, нужен
              токен: @BotFather → /mybots → бот → API Token.
            </p>
          </Block>
        </>
      )}

      {note && (
        <Block>
          <p className="text-[14px] leading-snug text-[#2a8bff]">{note}</p>
        </Block>
      )}
    </>
  )
}
