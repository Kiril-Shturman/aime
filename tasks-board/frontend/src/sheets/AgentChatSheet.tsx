import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Block } from 'konsta/react'
import Popup from '../components/Popup'
import { api } from '../api/client'
import { haptic } from '../lib/telegram'
import type { Agent, ChatZprava } from '../api/types'

// Переписка с агентом: владелец пишет, агент отвечает через board_say.
// Пока открыто — подтягиваем новые сообщения раз в пару секунд.
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
  const [posilam, setPosilam] = useState(false)
  const konec = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !agent) return
    let zive = true
    const nacti = async () => {
      try {
        const r = await api.agentChat(agent.id)
        if (zive) setZpravy(r.items)
      } catch {
        /* доска недоступна — покажем то, что уже есть */
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
    if (!agent || !text.trim() || posilam) return
    setPosilam(true)
    haptic('light')
    try {
      const z = await api.sayToAgent(agent.id, text.trim())
      setZpravy((p) => [...p, z])
      setText('')
    } catch {
      /* не ушло — текст останется в поле */
    }
    setPosilam(false)
  }

  const cas = (at: number) =>
    new Date(at * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <Popup open={open} onClose={onClose} title={agent ? `Чат · ${agent.name}` : 'Чат'}>
      <Block className="!mt-3 !mb-28">
        {zpravy.length === 0 && (
          <p className="py-8 text-center text-[14px] leading-snug text-black/45 dark:text-white/40">
            Сообщений пока нет. Напишите агенту — он прочитает это,
            когда придёт за задачами, и ответит здесь же.
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
        <div ref={konec} />
      </Block>

      {/* строка ввода прижата к низу, как в обычном чате */}
      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-black/[.06] bg-white/90 px-4 py-3 backdrop-blur dark:border-white/[.08] dark:bg-black/85">
        <div className="mx-auto flex max-w-[560px] items-end gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                poslat()
              }
            }}
            placeholder="Написать агенту"
            className="max-h-32 flex-1 resize-none rounded-2xl bg-ios-light-surface-1 px-4 py-2.5 text-[15px] text-black outline-none placeholder:text-black/40 dark:bg-ios-dark-surface-1 dark:text-white dark:placeholder:text-white/35"
          />
          <button
            type="button"
            onClick={poslat}
            disabled={!text.trim() || posilam}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-white disabled:opacity-40"
            aria-label="Отправить"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </Popup>
  )
}
