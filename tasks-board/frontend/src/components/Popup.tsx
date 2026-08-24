import { useEffect, type ReactNode } from 'react'
import { X, Check } from 'lucide-react'
import { Popup as KPopup, Navbar, Page, Link as KLink } from 'konsta/react'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  onSave?: () => void
  canSave?: boolean
  children: ReactNode
}

export default function Popup({
  open,
  onClose,
  title,
  onSave,
  canSave,
  children,
}: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <KPopup opened={open} onBackdropClick={onClose}>
      <Page>
        <Navbar
          title={title}
          left={
            <KLink iconOnly onClick={onClose}>
              <X size={22} strokeWidth={2.5} />
            </KLink>
          }
          right={
            onSave ? (
              <KLink
                iconOnly
                onClick={canSave ? onSave : undefined}
                className={
                  canSave ? '!text-[#4ea3ff]' : '!text-white/30 pointer-events-none'
                }
              >
                <Check size={24} strokeWidth={3} />
              </KLink>
            ) : undefined
          }
        />
        {children}
      </Page>
    </KPopup>
  )
}
