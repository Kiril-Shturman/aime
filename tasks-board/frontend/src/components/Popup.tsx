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
  // 'center' — обычная модалка по центру экрана (мобилки + компромисс на ПК);
  // 'right'  — на ПК разворачивается панелью во всю правую сторону,
  //            выезжает справа. На мобилках всё как в 'center': на весь экран.
  side?: 'center' | 'right'
  children: ReactNode
}

export default function Popup({
  open,
  onClose,
  title,
  pageClassName,
  onSave,
  canSave,
  side = 'center',
  children,
}: Props) {
  useEffect(() => {
    if (open) haptic('light')
  }, [open])

  // Правая панель на md+: занимает всю область справа от сайдбара —
  // от `--sidebar-width` до правого края экрана, во всю высоту.
  // Появление — как у Framework7 `f7-cover-v`: подложка не двигается,
  // панель выезжает снизу вверх и накрывает область.
  // Konsta по умолчанию центрует поповер через
  // `left-1/2 top-1/2 -translate-*-1/2` и в закрытом состоянии
  // прячет `translate-y-full`. Мы отменяем горизонтальную центровку
  // (крепим к сайдбару и правому краю), а по вертикали сами ведём
  // `open`: 0 — на месте, 100% — под экраном.
  const drawer = side === 'right'
  const drawerCls = drawer
    ? [
        'md:!top-0 md:!right-0',
        'md:!left-[var(--sidebar-width,18rem)]',
        'md:!w-auto md:!max-w-none md:!h-screen md:!max-h-none',
        'md:!rounded-none',
        'md:!translate-x-0',
        open ? 'md:!translate-y-0' : 'md:!translate-y-full',
      ].join(' ')
    : 'md:!w-[880px] md:!h-[90vh] md:!max-h-[900px]'

  return (
    <KPopup
      opened={open}
      onBackdropClick={onClose}
      // Фон белый по дефолту, при overscroll сверху видно белую полоску
      // над серой Page — прибиваем к тому же серому (ios-light-surface).
      className={`${drawerCls} !bg-ios-light-surface dark:!bg-ios-dark-surface`}
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
        {drawer ? (
          // Панель тянется во всю ширину области справа от сайдбара,
          // но контент читаемее в комфортной колонке — центруем
          // и ограничиваем ширину, как на страницах вроде /profile.
          <div className="mx-auto w-full max-w-[660px]">{children}</div>
        ) : (
          children
        )}
      </Page>
    </KPopup>
  )
}
