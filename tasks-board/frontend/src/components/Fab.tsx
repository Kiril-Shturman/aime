import { Plus } from 'lucide-react'
import { Fab as KFab } from 'konsta/react'

export default function Fab({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}) {
  return (
    <KFab
      onClick={onClick}
      aria-label={label}
      icon={<Plus size={24} strokeWidth={2} />}
      component="button"
      className="!fixed right-4 z-30"
      style={{ bottom: 'calc(22px + env(safe-area-inset-bottom))' }}
    />
  )
}
