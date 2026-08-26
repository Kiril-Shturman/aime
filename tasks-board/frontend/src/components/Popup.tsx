import { useEffect, type ReactNode } from 'react'
import { X, Check } from 'lucide-react'
import { Popup as KPopup, Navbar, Page, Link as KLink } from 'konsta/react'
import { haptic } from '../lib/telegram'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  pageClassName?: string
  onSave?: () => void
  canSave?: boolean
  children: ReactNode
}

export default function Popup({
  open,
  onClose,
  title,
  pageClassName,
  onSave,
  canSave,
  children,
}: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  return (
    <KPopup
      opened={open}
      onBackdropClick={onClose}
      // Konsta по умолчанию рисует поповер квадратом 640×640 на md+.
      // Для форм с большим количеством секций это тесно — расширяем.
      // Плюс: фон белый по дефолту, при overscroll сверху видно белую полоску
      // над серой Page — прибиваем фон к тому же серому (ios-light-surface).
      className="md:!w-[880px] md:!h-[90vh] md:!max-h-[900px] !bg-ios-light-surface dark:!bg-ios-dark-surface"
    >
      <Page className={pageClassName}>
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
                  canSave
                    ? '!text-primary'
                    : '!text-black/30 dark:!text-white/30 pointer-events-none'
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
