import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Trash2, UserPlus } from 'lucide-react'
import { BlockTitle, Block, List, ListItem, Toggle } from 'konsta/react'
import { api } from '../api/client'
import type { Access } from '../api/types'
import { haptic } from '../lib/telegram'

// Обычная ссылка на доску с ключом приглашения: открывается где угодно —
// в браузере, в Телеграме, на чужом телефоне. Вариант через t.me со
// start_param красивее, но требует настроенного Mini App у бота.
function inviteLink(key: string) {
  return `${location.origin}/?key=${key}`
}

export default function BoardAccess() {
  const [access, setAccess] = useState<Access | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => {
    api.getAccess().then(setAccess).catch(() => setAccess(null))
  }, [])
  useEffect(load, [load])

  if (!access) return null
  const pending = access.invites.filter((i) => !i.used_by)

  const toggle = async () => {
    haptic('light')
    setAccess(await api.setAccessOpen(!access.open))
  }

  const invite = async () => {
    haptic('success')
    const inv = await api.addInvite()
    await copy(inviteLink(inv.key))
    load()
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      /* без буфера — ссылку видно на экране */
    }
  }

  return (
    <>
      <BlockTitle>Доступ к доске</BlockTitle>
      <List strong inset>
        <ListItem
          title="Пускать других"
          subtitle={
            access.open
              ? 'Гости заходят по ссылке'
              : 'Доску вижу только я'
          }
          after={<Toggle checked={access.open} onChange={toggle} />}
        />
        {access.open && (
          <ListItem
            link
            title="Позвать человека"
            subtitle="Ссылка на доску, копируется сразу"
            media={<UserPlus size={20} className="text-[#2a8bff]" />}
            onClick={invite}
          />
        )}
      </List>

      {access.open && pending.length > 0 && (
        <>
          <BlockTitle>Ссылки ждут</BlockTitle>
          <List strong inset dividers>
            {pending.map((i) => {
              const link = inviteLink(i.key)
              return (
                <ListItem
                  key={i.code}
                  title={i.code}
                  subtitle="ссылка ещё не открыта"
                  after={
                    <span className="flex items-center gap-1">
                      <button
                        className="p-2 text-white/45"
                        onClick={() => copy(link)}
                      >
                        {copied === link ? <Check size={17} /> : <Copy size={17} />}
                      </button>
                      <button
                        className="p-2 -mr-2 text-white/35"
                        onClick={async () => {
                          haptic('light')
                          await api.deleteInvite(i.code)
                          load()
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </span>
                  }
                />
              )
            })}
          </List>
        </>
      )}

      {access.guests.length > 0 && (
        <>
          <BlockTitle>Кто ещё заходит</BlockTitle>
          <List strong inset dividers>
            {access.guests.map((g) => (
              <ListItem
                key={g.id}
                title={g.name}
                subtitle={g.handle || `id ${g.id}`}
                after={
                  <button
                    className="p-2 -mr-2 text-white/35"
                    onClick={async () => {
                      haptic('light')
                      await api.deleteGuest(g.id)
                      load()
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                }
              />
            ))}
          </List>
        </>
      )}

      {access.open && (
        <Block>
          <p className="text-white/45 text-[14px] leading-snug">
            Гость видит доску целиком и может менять задачи, но не управляет
            доступом. Выключишь тумблер — перестанут заходить все разом.
          </p>
        </Block>
      )}
    </>
  )
}
