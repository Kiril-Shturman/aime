import { X } from 'lucide-react'
import {
  Block,
  Link as KLink,
  List,
  ListItem,
  Toolbar,
  ToolbarPane,
} from 'konsta/react'
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
          <List strong inset>
            <ListItem
              media={
                <span className="w-10 h-10 flex items-center justify-center shrink-0">
                  <concept.Icon size={34} strokeWidth={1.7} />
                </span>
              }
              title={concept.label}
              subtitle={concept.hint}
            />
          </List>
          <Block className="!text-[15px] leading-snug whitespace-pre-line opacity-80">
            {concept.details}
          </Block>
        </>
      )}
    </Sheet>
  )
}
