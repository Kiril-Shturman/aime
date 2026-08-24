import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import {
  Block,
  BlockFooter,
  BlockTitle,
  Button,
  List,
  ListInput,
  Toolbar,
  ToolbarPane,
  Link as KLink,
} from 'konsta/react'
import Sheet from '../components/Sheet'
import { CONTEXT_SOURCES, type ContextSource } from '../lib/context-sources'

interface Props {
  open: boolean
  sourceId: string | null
  initial: Record<string, string>
  onClose: () => void
  onSave: (values: Record<string, string>) => void
  onRemove?: () => void
}

export default function ContextSourceSheet({
  open,
  sourceId,
  initial,
  onClose,
  onSave,
  onRemove,
}: Props) {
  const src: ContextSource | undefined = CONTEXT_SOURCES.find(
    (s) => s.id === sourceId,
  )
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) setValues({ ...initial })
  }, [open, initial])

  if (!src) return null

  const canSave = (values[src.fields[0].key] ?? '').trim() !== ''

  return (
    <Sheet open={open} onClose={onClose}>
      <Toolbar top className="justify-end ios:pt-4">
        <div className="ios:hidden" />
        <ToolbarPane>
          <KLink iconOnly onClick={onClose}>
            <X size={22} />
          </KLink>
        </ToolbarPane>
      </Toolbar>
      <BlockTitle>{src.label}</BlockTitle>
      <List strong inset>
        {src.fields.map((f) => (
          <ListInput
            key={f.key}
            label={f.label}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                [f.key]: (e.target as HTMLInputElement).value,
              }))
            }
          />
        ))}
      </List>
      <BlockFooter inset className="!text-[13px]">
        {src.hint}. Данные сохранятся с проектом — агент подтянет их сам после создания.
      </BlockFooter>

      <Block>
        <Button
          large
          rounded
          disabled={!canSave}
          onClick={() => onSave(values)}
        >
          Готово
        </Button>
      </Block>

      {onRemove && (
        <Block>
          <Button
            large
            rounded
            clear
            colors={{
              textIos: 'text-red-500',
              textMaterial: 'text-red-500',
              clearBgIos: 'bg-transparent active:bg-red-500/15',
              clearBgMaterial: 'bg-transparent',
            }}
            onClick={onRemove}
          >
            <Trash2 size={18} className="mr-2" />
            Убрать
          </Button>
        </Block>
      )}
    </Sheet>
  )
}
