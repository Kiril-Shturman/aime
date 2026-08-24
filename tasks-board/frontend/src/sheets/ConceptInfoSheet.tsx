import { X } from 'lucide-react'
import {
  Block,
  Link as KLink,
  Toolbar,
  ToolbarPane,
} from 'konsta/react'
import { Cell, IconContainer } from '@telegram-apps/telegram-ui'
import Sheet from '../components/Sheet'
import type { Concept } from './ProjectSheet'

interface Props {
  open: boolean
  concept: Concept | null
  onClose: () => void
}

export default function ConceptInfoSheet({ open, concept, onClose }: Props) {
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
      {concept && (
        <>
          <Block strong inset className="!p-0 overflow-hidden">
            <Cell
              multiline
              before={
                <IconContainer style={{ padding: '0 6px' }}>
                  <concept.Icon size={34} strokeWidth={1.7} />
                </IconContainer>
              }
              description={concept.hint}
            >
              {concept.label}
            </Cell>
          </Block>
          <Block className="!text-[15px] leading-snug whitespace-pre-line opacity-80">
            {concept.details}
          </Block>
        </>
      )}
    </Sheet>
  )
}
