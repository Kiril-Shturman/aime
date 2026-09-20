import { useEffect, useRef, useState } from 'react'
import { Messagebar, ToolbarPane } from 'konsta/react'
import { Send } from 'lucide-react'
import Popup from '../components/Popup'
import { Avatar } from '../components/Avatar'
import { api } from '../api/client'
import { haptic } from '../lib/telegram'
import type { Agent, ChatZprava } from '../api/types'

// Переписка с агентом. Поле ввода — тот же Messagebar, что в чатах с ИИ,
// в шапке справа аватарка агента.
export default function AgentChatSheet({
  open,
  onClose,
  agent,
}: {
  open: boolean
  onClose: () => void
  agent: Agent | null
}) {
  const [zpravy, setZpravy] = useState<ChatZprava[]>([])
  const [text, setText] = useState('')
  const [chyba, setChyba] = useState<string | null>(null)
  const konec = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !agent) return
    let zive = true
    const nacti = async () => {
      try {
        const r = await api.agentChat(agent.id)
        if (zive) setZpravy(r.items)
      } catch {
        /* доска недоступна — оставляем то, что уже показано */
      }
    }
    nacti()
    const t = window.setInterval(nacti, 2500)
    return () => {
      zive = false
      window.clearInterval(t)
    }
  }, [open, agent])

  useEffect(() => {
    konec.current?.scrollIntoView({ block: 'end' })
  }, [zpravy.length])

  const poslat = async () => {
    const hotovy = text.trim()
    if (!agent || !hotovy) return
    setChyba(null)
    haptic('light')
    try {
      const z = await api.sayToAgent(agent.id, hotovy)
      setZpravy((p) => [...p, z])
      setText('')
    } catch (e) {
      // молчаливая пропажа сообщения хуже ошибки — показываем причину
      setChyba(String(e).replace(/^Error:\s*\d+\s*[^:]*:\s*/, ''))
    }
  }

  const cas = (at: number) =>
    new Date(at * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <Popup
      open={open}
      onClose={onClose}
      title={agent ? agent.name : 'Чат'}
      headerRight={
        agent ? (
          <span className="pr-1">
            <Avatar member={agent} size={30} />
          </span>
        ) : undefined
      }
    >
      <div className="px-4 pb-40 pt-3">
        {zpravy.length === 0 && (
          <p className="py-10 text-center text-[14px] leading-snug text-black/45 dark:text-white/40">
            Сообщений пока нет. Напишите агенту — он получит это сразу, если
            держит канал, и ответит здесь же.
          </p>
        )}

        <div className="grid gap-2">
          {zpravy.map((z, i) => (
            <div
              key={`${z.at}-${i}`}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                z.from === 'owner'
                  ? 'ml-auto bg-primary text-white'
                  : 'bg-ios-light-surface-1 text-black dark:bg-ios-dark-surface-1 dark:text-white'
              }`}
            >
              <div className="whitespace-pre-wrap break-words text-[15px] leading-snug">{z.text}</div>
              <div
                className={`mt-1 text-[11px] ${
                  z.from === 'owner' ? 'text-white/60' : 'text-black/40 dark:text-white/35'
                }`}
              >
                {cas(z.at)}
              </div>
            </div>
          ))}
        </div>

        {chyba && (
          <p className="mt-3 text-center text-[13px] leading-snug text-[#ff9f0a]">
            Не отправилось: {chyba}
          </p>
        )}
        <div ref={konec} />
      </div>

      <Messagebar
        className="z-20 [&_.k-toolbar]:!pb-[max(5px,env(safe-area-inset-bottom))] [&_.k-toolbar>div]:!items-end [&_.k-toolbar>div]:!py-2 [&_textarea]:!py-3 [&_textarea]:!text-[16px] [&_textarea]:!leading-snug"
        placeholder={agent ? `Сообщение · ${agent.name}` : 'Сообщение'}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            poslat()
          }
        }}
        right={
          <ToolbarPane className="ios:h-10">
            <button
              type="button"
              aria-label="Отправить"
              onClick={poslat}
              className={`grid h-10 w-10 place-items-center ${
                text.trim() ? 'text-primary' : 'text-black/30 dark:text-white/30'
              }`}
            >
              <Send size={22} />
            </button>
          </ToolbarPane>
        }
      />
    </Popup>
  )
}
