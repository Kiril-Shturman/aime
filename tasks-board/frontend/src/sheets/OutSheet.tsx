import { Block } from 'konsta/react'
import Sheet from '../components/Sheet'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  text: string
}

export default function OutSheet({ open, onClose, title, text }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Block>
        <pre className="text-[13px] whitespace-pre-wrap font-mono bg-black/[.04] dark:bg-white/[.04] rounded-xl p-3">
          {text}
        </pre>
      </Block>
    </Sheet>
  )
}
