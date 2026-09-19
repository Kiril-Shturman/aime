import { useEffect, useMemo, useState } from 'react'
import { BlockTitle, Block } from 'konsta/react'
import { GitCommit } from 'lucide-react'
import { api, type Commit } from '../api/client'
import AnimatedList from './react-bits/animated-list'
import SimpleGraph from './react-bits/simple-graph'

// Лента коммитов рабочей копии проекта: сверху активность за две недели,
// ниже сами коммиты. Данные берём с сервера — он читает git log в клоне.
export default function GitHistory({
  projectId,
  color,
}: {
  projectId: string
  color: string
}) {
  const [commits, setCommits] = useState<Commit[] | null>(null)

  useEffect(() => {
    let zive = true
    api
      .gitLog(projectId, 30)
      .then((r) => zive && setCommits(r.items))
      .catch(() => zive && setCommits([]))
    return () => {
      zive = false
    }
  }, [projectId])

  // активность по дням: сколько коммитов пришлось на каждый из 14 дней
  const activity = useMemo(() => {
    const dny = Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - (13 - i))
      return d
    })
    return dny.map((d) => {
      const konec = d.getTime() + 86400000
      const pocet = (commits ?? []).filter(
        (c) => c.ts * 1000 >= d.getTime() && c.ts * 1000 < konec,
      ).length
      return {
        value: pocet,
        label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      }
    })
  }, [commits])

  if (!commits) return null

  if (commits.length === 0) {
    return (
      <>
        <BlockTitle>История</BlockTitle>
        <Block strong inset className="text-[14px] text-black/50 dark:text-white/50">
          Копии репозитория на сервере нет — подключите репозиторий, и здесь появятся коммиты.
        </Block>
      </>
    )
  }

  function kdy(ts: number) {
    const rozdil = Math.floor((Date.now() / 1000 - ts) / 60)
    if (rozdil < 60) return `${Math.max(1, rozdil)} мин назад`
    if (rozdil < 1440) return `${Math.floor(rozdil / 60)} ч назад`
    const dni = Math.floor(rozdil / 1440)
    if (dni < 30) return `${dni} дн назад`
    return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  }

  const items = commits.slice(0, 8).map((c) => ({
    id: c.hash,
    content: (
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${color}22`, color }}
        >
          <GitCommit size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-white">{c.subject}</span>
          <span className="mt-0.5 block text-[12px] text-white/45">
            {c.author} · {kdy(c.ts)} · <span className="font-mono">{c.hash}</span>
          </span>
        </span>
      </div>
    ),
  }))

  const zaDvaTydny = activity.reduce((s, d) => s + d.value, 0)

  return (
    <>
      <BlockTitle>История</BlockTitle>
      {zaDvaTydny === 0 ? (
        <Block strong inset className="!px-4 !py-3 text-[14px]">
          <span className="text-black/50 dark:text-white/50">Последние две недели без коммитов. </span>
          Последний — {kdy(commits[0].ts)}.
        </Block>
      ) : (
      <Block strong inset className="!px-4 !py-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[13px] text-black/50 dark:text-white/50">Коммиты за две недели</span>
          <span className="text-[13px] font-semibold text-black dark:text-white">{zaDvaTydny}</span>
        </div>
        <SimpleGraph
          data={activity}
          height={90}
          lineColor={color}
          dotColor={color}
          gradientFade
          showGrid={false}
          curved
        />
      </Block>
      )}

      <Block strong inset className="!p-3">
        {commits.length > 8 && (
          <div className="mb-2 px-1 text-[12px] text-black/45 dark:text-white/45">
            Последние 8 из {commits.length} коммитов
          </div>
        )}
        <AnimatedList
          items={items}
          autoAddDelay={0}
          maxItems={8}
          startFrom="top"
          animationType="slide"
          enterFrom="bottom"
          hoverEffect="none"
          clickEffect="none"
          fadeEdges={false}
          itemGap={6}
          height="auto"
          renderItem={(item) => (
            <div className="rounded-2xl bg-black/[.04] px-4 py-3 dark:bg-white/[.06]">
              {item.content}
            </div>
          )}
          className="!overflow-visible"
        />
      </Block>
    </>
  )
}
