import { X } from 'lucide-react'
import {
  Block,
  Link as KLink,
  Toolbar,
  ToolbarPane,
} from 'konsta/react'
import { Cell, IconContainer } from '@telegram-apps/telegram-ui'
import Sheet from '../components/Sheet'
import { CONTEXT_SOURCES } from '../lib/context-sources'

interface Props {
  open: boolean
  onClose: () => void
}

// Все «Что это» источника открывают одну модалку с той же вёрсткой:
// один Block, Cell-и через разделитель.
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
      <Block strong inset className="!p-0 overflow-hidden">
        {CONTEXT_SOURCES.map((s, i) => (
          <div key={s.id}>
            {i > 0 && <div className="border-t border-white/[.08]" />}
            <Cell
              multiline
              before={
                <IconContainer style={{ padding: '0 6px' }}>
                  {s.render()}
                </IconContainer>
              }
              description={s.hint}
            >
              {s.label}
            </Cell>
          </div>
        ))}
      </Block>
    </Sheet>
  )
}
