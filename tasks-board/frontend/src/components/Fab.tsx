import type { ReactNode } from 'react'
import { Fab as KFab } from 'konsta/react'

export default function Fab({
  onClick,
  children,
  label,
}: {
  onClick: () => void
  children: ReactNode
  label: string
}) {
  return (
    <KFab
      onClick={onClick}
      aria-label={label}
      icon={children}
      component="button"
      className="!fixed right-4 z-[150]"
      style={{ bottom: 'calc(22px + env(safe-area-inset-bottom))' }}
    />
  )
}
