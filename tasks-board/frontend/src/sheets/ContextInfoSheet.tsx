import { X } from 'lucide-react'
import {
  Link as KLink,
  List,
  ListItem,
  Toolbar,
  ToolbarPane,
} from 'konsta/react'
import Sheet from '../components/Sheet'
import { CONTEXT_SOURCES } from '../lib/context-sources'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ContextInfoSheet({ open, onClose }: Props) {
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
      <List strong inset dividers>
        {CONTEXT_SOURCES.map((s) => (
          <ListItem
            key={s.id}
            media={
              <span className="w-10 h-10 flex items-center justify-center shrink-0">
                {s.render()}
              </span>
            }
            title={s.label}
            subtitle={s.hint}
          />
        ))}
      </List>
    </Sheet>
  )
}
