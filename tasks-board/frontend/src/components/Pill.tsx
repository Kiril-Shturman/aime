import type { ReactNode } from 'react'
import { PILL_TONES } from '../lib/constants'

// маленький чип под названием: состояние участника, вид, что угодно короткое
export default function Pill({
  tone,
  children,
}: {
  tone: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center h-[22px] px-2 rounded-full text-[13px] font-medium leading-none ${
        PILL_TONES[tone] ?? PILL_TONES.free
      }`}
    >
      {children}
    </span>
  )
}
