import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, Clock3, Coins, Flag, RotateCcw, User, ListChecks, Trash2 } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
} from 'konsta/react'
import Popup from '../components/Popup'
import PickerSheet, { type PickerOption } from './PickerSheet'
import { MemberChip, StatusChip } from '../components/TaskChips'
import { api } from '../api/client'
import { useApp } from '../store/AppStore'
import { haptic } from '../lib/telegram'
import { TASK_STATUS_LABEL } from '../lib/constants'
import type { Task, TaskStatus } from '../api/types'

interface Props {
  open: boolean
  onClose: () => void
  task: Task | null
}

type Picker = null | 'status' | 'stage' | 'member'

export default function TaskEditSheet({ open, onClose, task }: Props) {
  const { state, refresh } = useApp()

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [stageId, setStageId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [report, setReport] = useState('')
  const [picker, setPicker] = useState<Picker>(null)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setStatus(task.status)
    setStageId(task.stage ?? null)
    setMemberId(task.member ?? null)
    setReport(task.report ?? '')
  }, [task])

  const current = state?.tasks.find((item) => item.id === task?.id) ?? task

  // Пока карточка открыта, данные воркера подтягиваются сами — обновлять
  // страницу руками не нужно.
  useEffect(() => {
    if (!open || (current?.status !== 'doing' && current?.status !== 'review')) return
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [open, current?.status, refresh])

  const project = state?.projects.find((p) => p.id === task?.project) ?? null
  const stage = project?.roadmap.find((s) => s.id === stageId) ?? null
  const member = project?.members.find((m) => m.id === memberId) ?? null
  const kontroler = current?.checker
    ? project?.members.find((m) => m.id === current.checker) ??
      state?.agents?.find((a) => a.id === current.checker)
    : null

  const stageOptions: PickerOption[] = useMemo(
    () => project?.roadmap.map((s) => ({ id: s.id, label: s.title })) ?? [],
    [project],
  )
  const memberOptions: PickerOption[] = useMemo(
    () =>
      project?.members.map((m) => ({
        id: m.id,
        label: m.name,
        sub: m.handle ?? m.role,
      })) ?? [],
    [project],
  )
  const statusOptions: PickerOption[] = useMemo(
    () =>
      (Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((k) => ({
        id: k,
        label: TASK_STATUS_LABEL[k],
      })),
    [],
  )

  const save = async () => {
    if (!task) return
    await api.patchTask(task.id, {
      title: title.trim() || task.title,
      status,
      stage: stageId ?? undefined,
      member: memberId ?? undefined,
      report: report.trim() || undefined,
    })
    haptic('success')
    onClose()
    await refresh()
  }

  // Владелец может решить сам, не дожидаясь проверяющего: принять
  // работу или вернуть её с причиной.
  const verdikt = async (ok: boolean) => {
    if (!task) return
    const why = ok ? '' : (prompt('Что не так?') || '').trim()
    if (!ok && !why) return
    haptic(ok ? 'success' : 'light')
    await api.reviewTask(task.id, { ok, why })
    onClose()
    await refresh()
  }

  const remove = async () => {
    if (!task) return
    if (!confirm('Удалить задачу?')) return
    await api.deleteTask(task.id)
    onClose()
    await refresh()
  }

  if (!task) return null

  return (
    <>
      <Popup
        open={open}
        onClose={onClose}
        title="Задача"
        onSave={save}
        canSave={!!title.trim()}
      >
        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Название"
            inputClassName="!min-h-[84px] !leading-snug"
            value={title}
            onChange={(e) => setTitle((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <Block className="!mt-2 !mb-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusChip status={task.status} />
            <MemberChip member={member} />
            {task.status === 'review' && (
              <MemberChip member={kontroler} prefix="проверяет" />
            )}
          </span>
        </Block>

        <BlockTitle>Куда относится</BlockTitle>
        <List strong inset>
          <ListItem
            onClick={() => setPicker('status')}
            media={<ListChecks size={20} />}
            title="Статус"
            after={TASK_STATUS_LABEL[status]}
            chevron
          />
          {project && project.roadmap.length > 0 && (
            <ListItem
              onClick={() => setPicker('stage')}
              media={<Flag size={20} />}
              title="Этап"
              after={
              <span className="block max-w-[52vw] truncate">
                {stage?.title ?? 'Без этапа'}
              </span>
            }
              chevron
            />
          )}
          <ListItem
            onClick={() => setPicker('member')}
            media={<User size={20} />}
            title="Исполнитель"
            after={
              <span className="block max-w-[52vw] truncate">
                {member?.name ?? 'Не выбран'}
              </span>
            }
            chevron
          />
        </List>

        {current?.status === 'doing' && <LiveProgress task={current} />}

        {current?.done && (current.commit || current.tokens || current.seconds) && (
          <>
            <BlockTitle>Итог</BlockTitle>
            <List strong inset>
              {current.commit && (
                <ListItem title="Коммит" after={current.commit.slice(0, 12)} />
              )}
              {current.tokens != null && (
                <ListItem title="Токены" after={String(current.tokens)} />
              )}
              {current.seconds != null && (
                <ListItem title="Секунды" after={String(current.seconds)} />
              )}
            </List>
          </>
        )}

        {(current?.status === 'review' || current?.check) && (
          <>
            <BlockTitle>Проверка</BlockTitle>
            <List strong inset>
              <ListItem
                title="Проверяет"
                after={kontroler?.name ?? 'никто не назначен'}
              />
              {current.check?.status === 'ok' && (
                <ListItem title="Вердикт" after="принято" />
              )}
              {current.check?.why && (
                <ListItem title="Что не так" text={current.check.why} />
              )}
            </List>
            {current.check?.shot && (
              <Block className="!mt-2">
                <img
                  src={current.check.shot}
                  alt="скрин проверки"
                  className="w-full rounded-2xl"
                />
              </Block>
            )}
            {current.status === 'review' && (
              <Block className="grid gap-2">
                <Button large rounded onClick={() => verdikt(true)}>
                  Принять
                </Button>
                <Button large rounded clear onClick={() => verdikt(false)}>
                  Вернуть в работу
                </Button>
              </Block>
            )}
          </>
        )}

        <BlockTitle>Отчёт</BlockTitle>
        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Что сделано, что осталось, ссылка на результат"
            value={report}
            onChange={(e) => setReport((e.target as HTMLTextAreaElement).value)}
          />
        </List>

        <Block>
          <Button large rounded onClick={save}>
            Сохранить
          </Button>
        </Block>
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
            onClick={remove}
          >
            <Trash2 size={18} className="mr-2" /> Удалить задачу
          </Button>
        </Block>
      </Popup>

      <PickerSheet
        open={picker === 'status'}
        onClose={() => setPicker(null)}
        title="Статус"
        options={statusOptions}
        value={status}
        onPick={(v) => v && setStatus(v as TaskStatus)}
        allowClear={false}
      />
      <PickerSheet
        open={picker === 'stage'}
        onClose={() => setPicker(null)}
        title="Этап"
        options={stageOptions}
        value={stageId}
        onPick={setStageId}
        clearLabel="Без этапа"
      />
      <PickerSheet
        open={picker === 'member'}
        onClose={() => setPicker(null)}
        title="Исполнитель"
        options={memberOptions}
        value={memberId}
        onPick={setMemberId}
        clearLabel="Не выбран"
      />
    </>
  )
}

function LiveProgress({ task }: { task: Task }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const started = toMs(task.started_at)
  const activity = toMs(task.progress_updated_at ?? task.started_at)
  const elapsed = started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0
  const silence = activity ? Math.max(0, Math.floor((Date.now() - activity) / 1000)) : 0
  const health = task.run_status === 'limited'
    ? 'limited'
    : silence >= 600
      ? 'stalled'
      : silence >= 120
        ? 'warning'
        : 'active'
  const healthText = health === 'limited'
    ? 'Лимит подписки — ждёт сброса'
    : health === 'stalled'
      ? 'Возможно, агент завис: больше 10 минут без действий'
      : health === 'warning'
        ? 'Агент молчит больше 2 минут'
        : 'Агент работает'
  const healthClass = health === 'active'
    ? 'bg-[#34c759]/12 text-[#248a3d] dark:text-[#30d158]'
    : health === 'warning'
      ? 'bg-[#ff9f0a]/12 text-[#b26a00] dark:text-[#ff9f0a]'
      : 'bg-[#ff453a]/12 text-[#c5221f] dark:text-[#ff6961]'

  return (
    <>
      <BlockTitle>Ход работы</BlockTitle>
      <Block strong inset className="!py-3">
        <div className={`mb-3 rounded-xl px-3 py-2 text-[13px] font-semibold ${healthClass}`}>
          {healthText}
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Activity size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] uppercase tracking-wide text-black/40 dark:text-white/35">Сейчас</div>
            <div className="mt-0.5 text-[16px] font-semibold text-black dark:text-white">
              {task.progress_step || 'Запускает задачу'}
            </div>
            <div className="mt-1 text-[13px] text-black/45 dark:text-white/40">
              Последнее действие {silence < 5 ? 'только что' : `${formatDuration(silence)} назад`}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ProgressStat icon={<Clock3 size={15} />} label="в работе" value={formatDuration(elapsed)} />
          <ProgressStat icon={<Coins size={15} />} label="токены" value={formatNumber(task.tokens ?? 0)} />
          <ProgressStat icon={<RotateCcw size={15} />} label="попытка" value={`${Math.max(1, task.attempts ?? 0)}/${task.max_attempts ?? 3}`} />
        </div>
      </Block>
    </>
  )
}

function ProgressStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[.04] px-2 py-2.5 dark:bg-white/[.06]">
      <div className="flex items-center gap-1 text-black/40 dark:text-white/35">{icon}<span className="text-[11px]">{label}</span></div>
      <div className="mt-1 truncate text-[14px] font-semibold text-black dark:text-white">{value}</div>
    </div>
  )
}

function toMs(value?: string | number | null) {
  if (!value) return 0
  if (typeof value === 'number') return value < 1_000_000_000_000 ? value * 1000 : value
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} с`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`
}

function formatNumber(value: number) {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}
