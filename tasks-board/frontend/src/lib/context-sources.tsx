import type { ReactElement } from 'react'
import {
  Bot,
  User,
  GitBranch,
  Library,
  FileText,
  Link2,
  MessagesSquare,
  Database,
  Plug,
  Cable,
  Files,
  Link as LinkIcon,
} from 'lucide-react'
import {
  SiGithub,
  SiClaude,
  SiJira,
} from '@icons-pack/react-simple-icons'

// Откуда агент возьмёт контекст о проекте, чтобы не переспрашивать всё
// с нуля. На создании выбираешь тапом → уточняешь в мини-форме.
export interface ContextField {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'textarea'
}

export interface ContextSource {
  id: string
  label: string
  hint: string
  color: string
  // тонкая lucide-иконка для информационного блока
  render: () => ReactElement
  // цветная/бренд-иконка для списка «Настройки»
  renderColored: () => ReactElement
  fields: ContextField[]
}

const plain = (Icon: typeof Bot): (() => ReactElement) =>
  () => <Icon size={28} strokeWidth={1.7} />

const colored = (
  Icon: typeof Bot,
  color: string,
): (() => ReactElement) => () => <Icon size={28} strokeWidth={1.8} color={color} />

const brand = (
  Icon: typeof SiGithub,
  color: string,
): (() => ReactElement) => () => <Icon size={26} color={color} />

export const CONTEXT_SOURCES: ContextSource[] = [
  {
    id: 'agent',
    label: 'Агент',
    hint: 'Получить его память, инструкции, текущие цели и рабочие материалы.',
    color: '#bf5af2',
    render: plain(Bot),
    renderColored: colored(Bot, '#bf5af2'),
    fields: [
      { key: 'handle', label: 'Ник агента', placeholder: '@agent' },
      {
        key: 'note',
        label: 'Что нужно',
        placeholder: 'память, инструкции, текущие цели',
        type: 'textarea',
      },
    ],
  },
  {
    id: 'human',
    label: 'Человек',
    hint: 'Задать несколько вопросов о проекте.',
    color: '#64d2ff',
    render: plain(User),
    renderColored: colored(User, '#64d2ff'),
    fields: [
      { key: 'contact', label: 'С кем поговорить', placeholder: '@username' },
      {
        key: 'questions',
        label: 'Что спросить',
        placeholder: 'по одному вопросу в строке',
        type: 'textarea',
      },
    ],
  },
  {
    id: 'git',
    label: 'Git-репозиторий',
    hint: 'Изучить README, код, историю изменений, issues и документацию.',
    color: '#000000',
    render: plain(GitBranch),
    // GitHub-логотип монохромный — тонируем currentColor,
    // чтобы в светлой теме он был чёрным, в тёмной — белым.
    renderColored: () => (
      <SiGithub size={26} className="text-black dark:text-white" />
    ),
    fields: [
      {
        key: 'repo',
        label: 'Адрес репозитория',
        placeholder: 'git@github.com:user/repo.git',
      },
      { key: 'branch', label: 'Ветка (необязательно)', placeholder: 'main' },
    ],
  },
  {
    id: 'kb',
    label: 'База знаний',
    hint: 'Использовать документы и материалы через RAG.',
    color: '#30d158',
    render: plain(Library),
    renderColored: colored(Database, '#30d158'),
    fields: [
      { key: 'url', label: 'Ссылка на базу', placeholder: 'https://…' },
      { key: 'name', label: 'Название', placeholder: 'например, Confluence' },
    ],
  },
  {
    id: 'files',
    label: 'Файлы',
    hint: 'Загрузить ТЗ, заметки, презентации или таблицы.',
    color: '#ffd60a',
    render: plain(FileText),
    renderColored: colored(Files, '#ffd60a'),
    fields: [
      {
        key: 'note',
        label: 'Что за файлы',
        placeholder: 'опиши, что загрузишь',
        type: 'textarea',
      },
    ],
  },
  {
    id: 'link',
    label: 'Ссылка',
    hint: 'Изучить сайт, документацию или страницу продукта.',
    color: '#4ea3ff',
    render: plain(Link2),
    renderColored: colored(LinkIcon, '#4ea3ff'),
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://…' },
      {
        key: 'note',
        label: 'На что обратить внимание',
        placeholder: 'необязательно',
        type: 'textarea',
      },
    ],
  },
  {
    id: 'chat',
    label: 'Чат',
    hint: 'Импортировать переписку из ChatGPT, Claude или другого сервиса.',
    color: '#d97757',
    render: plain(MessagesSquare),
    renderColored: brand(SiClaude, '#d97757'),
    fields: [
      {
        key: 'export',
        label: 'Ссылка на экспорт или файл',
        placeholder: 'ссылка или ID разговора',
      },
    ],
  },
  {
    id: 'tracker',
    label: 'Трекер задач',
    hint: 'Получить данные из GitHub Issues, Jira, Trello, Notion и подобных.',
    color: '#2684ff',
    render: plain(Database),
    renderColored: brand(SiJira, '#2684ff'),
    fields: [
      { key: 'url', label: 'Адрес проекта', placeholder: 'https://…' },
      { key: 'token', label: 'Токен (если нужен)', placeholder: '' },
    ],
  },
  {
    id: 'mcp',
    label: 'MCP-подключение',
    hint: 'Получить контекст из любого совместимого источника.',
    color: '#a2845e',
    render: plain(Plug),
    renderColored: colored(Cable, '#a2845e'),
    fields: [
      {
        key: 'endpoint',
        label: 'MCP-эндпоинт',
        placeholder: 'stdio:… или https://…',
      },
      { key: 'name', label: 'Название', placeholder: 'необязательно' },
    ],
  },
]
