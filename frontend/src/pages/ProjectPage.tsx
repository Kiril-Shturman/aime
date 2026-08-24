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
  Plus,
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
import {
  ModuleIcon,
  ProjectIcon,
  StageIcon,
  TaskIcon,
} from '../components/WorkItemIcons'

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
  const [taskStage, setTaskStage] = useState<string | null>(null)
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
        label: 'Добавить задачу',
        icon: Plus,
        onSelect: () => {
          setTaskStage(null)
          setTaskOpen(true)
        },
      },
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
      <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

  const visibleTasks = [...openTasks, ...doneTasks]
  const looseTasks = visibleTasks.filter(
    (t) => !t.stage || !project.roadmap.some((s) => s.id === t.stage),
  )
  const projectTasks = state?.tasks.filter((t) => t.project === id) ?? []
  const projectDone = projectTasks.filter((t) => t.done).length
  const projectProgress = projectTasks.length
    ? projectDone / projectTasks.length
    : 0
  const moduleMap = new Map<string, Stage[]>()
  project.roadmap.forEach((stage) => {
    const moduleName = stage.module?.trim() || 'Основной модуль'
    moduleMap.set(moduleName, [...(moduleMap.get(moduleName) ?? []), stage])
  })
  const modules = Array.from(moduleMap, ([name, stages]) => ({ name, stages }))

  const openTaskSheet = (stage: string | null = null) => {
    setTaskStage(stage)
    setTaskOpen(true)
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      <List strong inset>
        <ListItem
          media={
            <span className="w-12 h-12 rounded-2xl bg-primary/12 text-primary flex items-center justify-center">
              <ProjectIcon size={28} />
            </span>
          }
          title={<span className="font-semibold">{project.name}</span>}
          subtitle={`${modules.length} ${modules.length === 1 ? 'модуль' : 'модуля'} · ${project.roadmap.length} этапов · ${projectTasks.length} задач`}
          text={
            <span className="block mt-2">
              {project.note && (
                <span className="block text-black/65 dark:text-white/60 mb-2">
                  {project.note}
                </span>
              )}
              <span className="flex items-center gap-2">
                <Progressbar progress={projectProgress} className="flex-1" />
                <span className="text-[12px] text-black/50 dark:text-white/50 shrink-0">
                  {projectDone} из {projectTasks.length}
                </span>
              </span>
            </span>
          }
        />
      </List>

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

      {project.type !== 'process' && (
        <>
          <BlockTitle>{memberFilter ? 'План участника' : 'План проекта'}</BlockTitle>

          {modules.length === 0 ? (
            <List strong inset>
              <ListItem
                link
                onClick={() => setStageOpen(true)}
                media={<ModuleIcon size={28} className="text-primary" />}
                title="Создать первый модуль"
                subtitle="Добавь этап — модуль появится автоматически"
              />
            </List>
          ) : (
            modules.map((module) => {
              const moduleTasks = visibleTasks.filter((task) =>
                module.stages.some((stage) => stage.id === task.stage),
              )
              const moduleDone = moduleTasks.filter((task) => task.done).length

              return (
                <section
                  key={module.name}
                  className="mx-safe-4 mb-5 rounded-3xl overflow-hidden bg-ios-light-surface-1 dark:bg-ios-dark-surface-1"
                >
                  <div className="flex items-center gap-3 px-4 py-4 bg-primary/[.07] dark:bg-primary/[.10]">
                    <span className="w-11 h-11 rounded-2xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                      <ModuleIcon size={25} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Модуль
                      </div>
                      <div className="text-[18px] font-semibold text-black dark:text-white truncate">
                        {module.name}
                      </div>
                      <div className="text-[13px] text-black/50 dark:text-white/50">
                        {module.stages.length} этапов · {moduleDone} из {moduleTasks.length} задач готово
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-black/[.08] dark:divide-white/[.08]">
                    {module.stages.map((stage) => {
                      const stageTasks = visibleTasks.filter(
                        (task) => task.stage === stage.id,
                      )
                      const stageProgress = stage.progress.total
                        ? stage.progress.done / stage.progress.total
                        : 0

                      return (
                        <div key={stage.id}>
                          <button
                            type="button"
                            onClick={() => setStageInfo(stage)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-black/[.05] dark:active:bg-white/[.06]"
                          >
                            <span className="w-9 h-9 rounded-xl bg-black/[.04] dark:bg-white/[.06] text-primary flex items-center justify-center shrink-0">
                              <StageIcon size={22} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                                  Этап
                                </span>
                                {stage.date && (
                                  <span className="text-[11px] text-black/40 dark:text-white/40">
                                    {stage.date}
                                  </span>
                                )}
                              </span>
                              <span className="block text-[16px] font-semibold text-black dark:text-white truncate">
                                {stage.title}
                              </span>
                              {stage.progress.total > 0 && (
                                <span className="flex items-center gap-2 mt-1.5">
                                  <Progressbar progress={stageProgress} className="flex-1" />
                                  <span className="text-[11px] text-black/45 dark:text-white/45 shrink-0">
                                    {stage.progress.done}/{stage.progress.total}
                                  </span>
                                </span>
                              )}
                            </span>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                                stage.status === 'done'
                                  ? 'bg-[#30d158]/20 text-[#248a3d] dark:text-[#30d158]'
                                  : stage.status === 'active'
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-black/[.06] text-black/55 dark:bg-white/10 dark:text-white/55'
                              }`}
                            >
                              {STAGE_STATUS_LABEL[stage.status]}
                            </span>
                          </button>

                          <div className="bg-black/[.015] dark:bg-white/[.015] border-t border-black/[.05] dark:border-white/[.05]">
                            {stageTasks.length > 0 ? (
                              <List nested dividers>
                                {stageTasks.map((task) => (
                                  <TaskRow key={task.id} task={task} onEdit={setEditTask} />
                                ))}
                              </List>
                            ) : (
                              <div className="px-4 py-3 flex items-center gap-3 text-[14px] text-black/45 dark:text-white/45">
                                <TaskIcon size={20} className="text-primary/60" />
                                Задач пока нет
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => openTaskSheet(stage.id)}
                              className="w-full px-4 py-3 flex items-center gap-3 text-[14px] text-primary border-t border-black/[.05] dark:border-white/[.05] active:bg-primary/[.06]"
                            >
                              <Plus size={20} />
                              Добавить задачу
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })
          )}

          {looseTasks.length > 0 && (
            <>
              <BlockTitle>Без этапа</BlockTitle>
              <List strong inset>
                {looseTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={setEditTask} />
                ))}
                <ListItem
                  link
                  onClick={() => openTaskSheet()}
                  media={<Plus size={20} className="text-primary" />}
                  title="Добавить задачу"
                />
              </List>
            </>
          )}
        </>
      )}

      {project.type === 'process' && (
        <>
          <BlockTitle>{memberFilter ? 'Задачи участника' : 'Задачи'}</BlockTitle>
          <List strong inset>
            {visibleTasks.length === 0 ? (
              <ListItem title="Пусто" />
            ) : (
              visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditTask} />
              ))
            )}
          </List>
        </>
      )}

      {project.members.length > 0 && (
        <>
          <BlockTitle>Команда</BlockTitle>
          <List strong inset dividers>
            {project.members.map((member) => (
              <ListItem
                key={member.id}
                link
                onClick={() =>
                  memberFilter === member.id
                    ? setMemberFilter(null)
                    : setMemberInfo(member)
                }
                media={<Avatar member={member} color={project.color} size={44} />}
                title={member.name}
                subtitle={
                  <span className="flex flex-wrap gap-1.5 mt-1">
                    <Pill tone={teamOpenCount.get(member.id) ? 'work' : 'free'}>
                      {teamOpenCount.get(member.id)
                        ? `${teamOpenCount.get(member.id)} в работе`
                        : 'свободен'}
                    </Pill>
                    {member.kind && (
                      <Pill tone={member.kind}>{kindLabel(member.kind)}</Pill>
                    )}
                  </span>
                }
                chevronIcon={
                  <ChevronRight
                    size={18}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-black/25 dark:text-white/25"
                  />
                }
                innerClassName="pr-10"
                className={
                  memberFilter === member.id
                    ? 'bg-black/[.04] dark:bg-white/[.06]'
                    : ''
                }
              />
            ))}
          </List>
        </>
      )}

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        target={menuBtnRef}
      />

      <TaskSheet
        open={taskOpen}
        onClose={() => {
          setTaskOpen(false)
          setTaskStage(null)
        }}
        defaultProject={id}
        defaultStage={taskStage}
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
