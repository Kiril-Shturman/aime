import { useEffect, type ReactNode } from 'react'
import { X, Check } from 'lucide-react'
import { Popup as KPopup, Navbar, Link as KLink, Page } from 'konsta/react'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  onSave?: () => void
  saveLabel?: string
  children: ReactNode
}

export default function Popup({
  open,
  onClose,
  title,
  onSave,
  saveLabel,
  children,
}: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <KPopup
      opened={open}
      onBackdropClick={onClose}
      className="!bg-black"
    >
      <Page className="!bg-black">
        <Navbar
          title={title}
          left={
            <KLink navbar onClick={onClose}>
              <X size={22} />
            </KLink>
          }
          right={
            onSave ? (
              <KLink navbar onClick={onSave}>
                {saveLabel ? saveLabel : <Check size={22} strokeWidth={2.5} />}
              </KLink>
            ) : undefined
          }
        />
        {children}
      </Page>
    </KPopup>
  )
}
