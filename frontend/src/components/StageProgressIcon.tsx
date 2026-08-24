import { StageIcon } from './WorkItemIcons'

interface Props {
  progress: number
  size?: number
}

export default function StageProgressIcon({ progress, size = 58 }: Props) {
  const normalized = Math.max(0, Math.min(1, progress))
  const radius = 25
  const circumference = 2 * Math.PI * radius

  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 58 58"
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="29"
          cy="29"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-black/[.08] dark:text-white/[.10]"
        />
        <circle
          cx="29"
          cy="29"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - normalized)}
          className="text-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="w-11 h-11 rounded-full bg-primary/[.10] text-primary flex items-center justify-center">
        <StageIcon size={23} />
      </span>
    </span>
  )
}
