import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  MoreHorizontal,
  Flag,
  Pencil,
  User,
  GitBranch,
  RefreshCw,
  Link as LinkIcon,
  Trash2,
  ChevronRight,
  Workflow,
} from 'lucide-react'
import {
  Block,
  BlockTitle,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Progressbar,
  Link as KLink,
} from 'konsta/react'
import { api, type GitStatus } from '../api/client'
import { useApp } from '../store/AppStore'
import { Avatar } from '../components/Avatar'
import Menu, { type MenuItem } from '../components/Menu'
import Pill from '../components/Pill'
import Fab from '../components/Fab'
import TaskRow from '../components/TaskRow'
import {
  PROCESS_KINDS,
  STAGE_STATUS_LABEL,
  kindLabel,
  processKindLabel,
  repoShort,
  repoUrl,
} from '../lib/constants'
import { haptic } from '../lib/telegram'
import TaskSheet from '../sheets/TaskSheet'
import TaskEditSheet from '../sheets/TaskEditSheet'
import ProjectSheet from '../sheets/ProjectSheet'
import MemberSheet from '../sheets/MemberSheet'
import MemberInfoSheet from '../sheets/MemberInfoSheet'
import StageSheet from '../sheets/StageSheet'
import StageInfoSheet from '../sheets/StageInfoSheet'
import GitSheet from '../sheets/GitSheet'
import GoalSheet from '../sheets/GoalSheet'
import type { Member, Stage, Task } from '../api/types'

export default function ProjectPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { state, refresh } = useApp()
  const project = state?.projects.find((p) => p.id === id) ?? null

  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef<HTMLAnchorElement>(null)

  const [taskOpen, setTaskOpen] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [projectSheetOpen, setProjectSheetOpen] = useState(false)
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberInfo, setMemberInfo] = useState<Member | null>(null)
  const [stageOpen, setStageOpen] = useState(false)
  const [stageInfo, setStageInfo] = useState<Stage | null>(null)
  const [gitOpen, setGitOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .getGit(id)
      .then((r) => setGitStatus(r.status))
      .catch(() => setGitStatus(null))
  }, [id])

  const openTasks = useMemo(
    () =>
      state?.tasks.filter(
        (t) =>
          !t.done && t.project === id && (!memberFilter || t.member === memberFilter),
      ) ?? [],
    [state?.tasks, id, memberFilter],
  )

  const doneTasks = useMemo(
    () =>
      state?.tasks.filter(
        (t) =>
          t.done && t.project === id && (!memberFilter || t.member === memberFilter),
      ) ?? [],
    [state?.tasks, id, memberFilter],
  )

  const teamOpenCount = useMemo(() => {
    const map = new Map<string, number>()
    state?.tasks
      .filter((t) => !t.done && t.project === id)
      .forEach((t) => {
        if (!t.member) return
        map.set(t.member, (map.get(t.member) ?? 0) + 1)
      })
    return map
  }, [state?.tasks, id])

  const pullGit = async () => {
    if (!project?.repo) return
    haptic('light')
    try {
      const r = await api.connectGit(id, project.repo)
      setGitStatus(r.status)
      haptic('success')
    } catch {
      haptic('error')
    }
  }

  const deleteProject = async () => {
    if (!confirm('Удалить проект вместе с задачами?')) return
    await api.deleteProject(id)
    await refresh()
    window.history.back()
  }

  const gitLine = () => {
    if (!gitStatus) return 'копии на сервере нет'
    return [
      gitStatus.branch,
      gitStatus.dirty ? `правок: ${gitStatus.dirty}` : null,
      gitStatus.last ?? null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const menuItems: MenuItem[] = useMemo(() => {
    if (!project) return []
    const items: MenuItem[] = [
      { label: 'Поставить цель', icon: Flag, onSelect: () => setGoalOpen(true) },
      {
        label: project.type === 'process' ? 'Изменить процесс' : 'Изменить проект',
        icon: Pencil,
        onSelect: () => setProjectSheetOpen(true),
      },
      {
        label: 'Добавить участника',
        icon: User,
        onSelect: () => setMemberOpen(true),
      },
    ]
    if (project.type !== 'process') {
      items.push({
        label: 'Добавить этап',
        icon: Flag,
        onSelect: () => setStageOpen(true),
      })
    }
    if (project.repo) {
      items.push({
        label: repoShort(project.repo),
        sub: gitLine(),
        icon: GitBranch,
        onSelect: () => setGitOpen(true),
      })
      items.push({
        label: 'Обновить из гита',
        icon: RefreshCw,
        onSelect: pullGit,
      })
      items.push({
        label: 'Открыть на GitHub',
        icon: LinkIcon,
        onSelect: () => window.open(repoUrl(project.repo!), '_blank'),
      })
    } else {
      items.push({
        label: 'Подключить репозиторий',
        icon: GitBranch,
        onSelect: () => setGitOpen(true),
      })
    }
    items.push({
      label: project.type === 'process' ? 'Удалить процесс' : 'Удалить проект',
      icon: Trash2,
      red: true,
      onSelect: deleteProject,
    })
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, gitStatus])

  if (!project) {
    return (
      <Page>
        <Navbar
          title="Не найдено"
          left={
            <NavbarBackLink
              text="Назад"
              onClick={() => navigate('/')}
            />
          }
        />
        <Block>Проект не найден.</Block>
      </Page>
    )
  }

  const stagesWithTasks = project.roadmap.filter((st) =>
    openTasks.some((t) => t.stage === st.id),
  )
  const looseTasks = openTasks.filter(
    (t) => !t.stage || !project.roadmap.some((s) => s.id === t.stage),
  )

  return (
    <Page>
      <Navbar
        title={project.name}
        left={
          <NavbarBackLink
            text="Назад"
            onClick={() => navigate('/')}
          />
        }
        right={
          <KLink
            iconOnly
            ref={menuBtnRef}
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal size={24} />
          </KLink>
        }
      />

      {project.note && <Block>{project.note}</Block>}

      {project.members.length > 0 && (
        <>
          <BlockTitle>Команда</BlockTitle>
          {/* «Data list, with icons» из Konsta: иконка слева, значение справа */}
          <List strong inset dividers>
            {project.members.map((m) => (
              <ListItem
                key={m.id}
                link
                onClick={() =>
                  memberFilter === m.id
                    ? setMemberFilter(null)
                    : setMemberInfo(m)
                }
                media={<Avatar member={m} color={project.color} size={44} />}
                title={m.name}
                // чипы вместо значения справа: состояние и кто это по роли
                subtitle={
                  <span className="flex flex-wrap gap-1.5 mt-1">
                    <Pill tone={teamOpenCount.get(m.id) ? 'work' : 'free'}>
                      {teamOpenCount.get(m.id)
                        ? `${teamOpenCount.get(m.id)} в работе`
                        : 'свободен'}
                    </Pill>
                    {m.kind && <Pill tone={m.kind}>{kindLabel(m.kind)}</Pill>}
                  </span>
                }
                // стрелка живёт в строке заголовка, поэтому у многострочного
                // элемента она уезжает вверх — ставим свою по центру
                chevronIcon={
                  <ChevronRight
                    size={18}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/25"
                  />
                }
                innerClassName="pr-10"
                className={memberFilter === m.id ? 'bg-black/[.04] dark:bg-white/[.06]' : ''}
              />
            ))}
          </List>
        </>
      )}

      {project.type === 'process' && project.process_kind && (
        <>
          <BlockTitle>Способ организации</BlockTitle>
          <List strong inset>
            <ListItem
              media={<Workflow size={20} />}
              title={processKindLabel(project.process_kind)}
              subtitle={
                PROCESS_KINDS.find((k) => k.id === project.process_kind)?.hint
              }
            />
          </List>
        </>
      )}

      {project.type !== 'process' && project.roadmap.length > 0 && (
        <>
          <BlockTitle>Роудмап</BlockTitle>
          <List strong inset>
            {project.roadmap.map((st) => (
              <ListItem
                key={st.id}
                onClick={() => setStageInfo(st)}
                media={
                  <span
                    className={`w-3 h-3 rounded-full shrink-0 ${
                      st.status === 'done'
                        ? 'bg-[#30d158]'
                        : st.status === 'active'
                          ? 'bg-[#2a8bff]'
                          : 'bg-white/25'
                    }`}
                  />
                }
                title={st.title}
                subtitle={st.date ?? undefined}
                text={
                  st.progress.total > 0 ? (
                    <span className="flex items-center gap-2 mt-1.5">
                      <Progressbar
                        progress={
                          Math.round((100 * st.progress.done) / st.progress.total) /
                          100
                        }
                        className="flex-1"
                      />
                      <span className="text-white/50 text-[12px] shrink-0">
                        {st.progress.done} из {st.progress.total}
                      </span>
                    </span>
                  ) : undefined
                }
                after={
                  <span
                    className={`text-[12px] px-2 py-0.5 rounded-full shrink-0 ${
                      st.status === 'done'
                        ? 'bg-[#30d158]/20 text-[#30d158]'
                        : st.status === 'active'
                          ? 'bg-[#2a8bff]/20 text-[#4ea3ff]'
                          : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {STAGE_STATUS_LABEL[st.status]}
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}

      <BlockTitle>{memberFilter ? 'Задачи участника' : 'Задачи'}</BlockTitle>
      {openTasks.length === 0 ? (
        <List strong inset>
          <ListItem title="Пусто" />
        </List>
      ) : project.roadmap.length > 0 ? (
        <>
          {stagesWithTasks.map((st) => (
            <div key={st.id}>
              <BlockTitle>{st.title}</BlockTitle>
              <List strong inset>
                {openTasks
                  .filter((t) => t.stage === st.id)
                  .map((t) => (
                    <TaskRow key={t.id} task={t} onEdit={setEditTask} />
                  ))}
              </List>
            </div>
          ))}
          {looseTasks.length > 0 && (
            <div>
              {stagesWithTasks.length > 0 && <BlockTitle>Без этапа</BlockTitle>}
              <List strong inset>
                {looseTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={setEditTask} />
                ))}
              </List>
            </div>
          )}
        </>
      ) : (
        <List strong inset>
          {openTasks.map((t) => (
            <TaskRow key={t.id} task={t} onEdit={setEditTask} />
          ))}
        </List>
      )}

      {doneTasks.length > 0 && (
        <>
          <BlockTitle>Завершено</BlockTitle>
          <List strong inset>
            {doneTasks.map((t) => (
              <TaskRow key={t.id} task={t} onEdit={setEditTask} />
            ))}
          </List>
        </>
      )}

      <Fab label="Новая задача" onClick={() => setTaskOpen(true)} />

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        target={menuBtnRef}
      />

      <TaskSheet
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        defaultProject={id}
      />
      <TaskEditSheet
        open={editTask != null}
        onClose={() => setEditTask(null)}
        task={editTask}
      />
      <ProjectSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        project={project}
      />
      <MemberSheet
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        projectId={id}
      />
      <MemberInfoSheet
        open={memberInfo != null}
        onClose={() => setMemberInfo(null)}
        projectId={id}
        member={memberInfo}
        projectColor={project.color}
      />
      <StageSheet
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        projectId={id}
      />
      <StageInfoSheet
        open={stageInfo != null}
        onClose={() => setStageInfo(null)}
        projectId={id}
        stage={stageInfo}
      />
      <GitSheet
        open={gitOpen}
        onClose={() => setGitOpen(false)}
        projectId={id}
        initialRepo={project.repo ?? ''}
        initialBranch={gitStatus?.branch ?? ''}
      />
      <GoalSheet
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        defaultProject={id}
      />
    </Page>
  )
}
