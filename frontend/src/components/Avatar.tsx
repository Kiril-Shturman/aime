import type { Member } from '../api/types'

export function Avatar({
  member,
  color,
  size = 32,
}: {
  member: Member
  color?: string
  size?: number
}) {
  if (member.avatar) {
    return (
      <img
        src={member.avatar}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    )
  }
  const letter = (member.name || member.handle || '?')
    .replace('@', '')
    .charAt(0)
    .toUpperCase()
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color ?? '#48484a',
        fontSize: size * 0.45,
      }}
      className="rounded-full flex items-center justify-center text-white font-semibold shrink-0"
    >
      {letter}
    </div>
  )
}
