import { Check } from 'lucide-react'
import { List, ListItem } from 'konsta/react'
import Sheet from '../components/Sheet'

export interface PickerOption {
  id: string
  label: string
  sub?: string
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  options: PickerOption[]
  value: string | null
  onPick: (id: string | null) => void
  allowClear?: boolean
  clearLabel?: string
}

export default function PickerSheet({
  open,
  onClose,
  title,
  options,
  value,
  onPick,
  allowClear = true,
  clearLabel = 'Не выбрано',
}: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <List strong inset>
        {allowClear && (
          <ListItem
            onClick={() => {
              onPick(null)
              onClose()
            }}
            title={clearLabel}
            after={
              value == null ? (
                <Check size={18} className="text-[#2a8bff]" />
              ) : undefined
            }
          />
        )}
        {options.map((o) => (
          <ListItem
            key={o.id}
            onClick={() => {
              onPick(o.id)
              onClose()
            }}
            title={o.label}
            subtitle={o.sub}
            after={
              value === o.id ? (
                <Check size={18} className="text-[#2a8bff]" />
              ) : undefined
            }
          />
        ))}
      </List>
    </Sheet>
  )
}
