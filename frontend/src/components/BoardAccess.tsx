import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Link2 } from 'lucide-react'
import { Block, BlockTitle, List, ListItem, Toggle } from 'konsta/react'
import { api } from '../api/client'
import type { Access } from '../api/types'
import { haptic } from '../lib/telegram'

// Один тумблер: доска либо только для своих, либо открыта всем, у кого
// есть адрес. Возни с приглашениями и списками гостей не хотим.
export default function BoardAccess() {
  const [access, setAccess] = useState<Access | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    api.getAccess().then(setAccess).catch(() => setAccess(null))
  }, [])
  useEffect(load, [load])

  if (!access) return null

  const toggle = async () => {
    haptic('light')
    setAccess(await api.setAccessOpen(!access.open))
  }

  const copy = async () => {
    haptic('success')
    try {
      await navigator.clipboard.writeText(location.origin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* без буфера — адрес видно в строке браузера */
    }
  }

  return (
    <>
      <BlockTitle>Доступ к доске</BlockTitle>
      <List strong inset>
        <ListItem
          title="Пускать других"
          subtitle={
            access.open ? 'Открыта всем, у кого есть адрес' : 'Только я и мои агенты'
          }
          after={<Toggle checked={access.open} onChange={toggle} />}
        />
        {access.open && (
          <ListItem
            link
            title="Скопировать адрес"
            subtitle={location.host}
            media={<Link2 size={20} className="text-[#2a8bff]" />}
            onClick={copy}
            after={copied ? <Check size={17} /> : <Copy size={17} />}
          />
        )}
      </List>

      {access.open && (
        <Block>
          <p className="text-black/55 dark:text-white/45 text-[14px] leading-snug">
            Пока тумблер включён, доску откроет любой, кто знает адрес, и
            сможет менять задачи. Выключишь — снова видно только тебе.
          </p>
        </Block>
      )}
    </>
  )
}
