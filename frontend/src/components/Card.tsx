import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
  pad = false,
}: {
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <div
      className={`rounded-2xl overflow-hidden bg-ios-light-surface-1 dark:bg-ios-dark-surface-1 divide-y divide-black/[.08] dark:divide-white/[.08] ${
        pad ? 'p-4' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function CardRow({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  const cls = `flex items-center gap-3 px-4 py-3 ${
    onClick ? 'active:bg-black/[.05] dark:active:bg-white/[.05] cursor-pointer' : ''
  } ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${cls}`}>
        {children}
      </button>
    )
  }
  return <div className={cls}>{children}</div>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pt-6 pb-2 text-black/50 dark:text-white/50 text-[13px] font-medium uppercase tracking-wider">
      {children}
    </div>
  )
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-black/70 dark:text-white/70 text-[15px] font-semibold">
      {children}
    </div>
  )
}
