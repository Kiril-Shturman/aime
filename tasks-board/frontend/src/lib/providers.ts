// Реестр 15 чат-провайдеров. slug идёт в URL (/chat/:provider), openrouter —
// префикс, которым OpenRouter (через ai-webapi AIService) адресует конкретную
// модель. Аватарки в /providers/. avatar=null → компоненты рисуют текстовую
// плитку по первой букве name.
//
// ЭТО ШАГ 1: модели захардкожены как plausible-defaults. На Шаге 2 подтянем
// живой список из /api/AI/models и заменим этот блок.

export interface ProviderModel {
  id: string      // openrouter model id, например 'openai/gpt-4o'
  name: string    // человекочитаемое имя
  desc: string    // короткая подпись под именем
  free?: boolean  // помечать зелёным FREE-бейджем
}

export interface ChatProvider {
  slug: string
  name: string
  avatar: string | null
  color: string        // фолбэк-плитка (буква на этом фоне)
  openrouter: string   // префикс vendor'а в openrouter (для будущего /api/AI/models)
  models: ProviderModel[]
}

const A = '/providers'

export const CHAT_PROVIDERS: ChatProvider[] = [
  {
    slug: 'chatgpt',
    name: 'ChatGPT',
    avatar: `${A}/gpt.png`,
    color: '#10a37f',
    openrouter: 'openai',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o', desc: 'Быстрая и универсальная' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', desc: 'Дешевле и быстрее', free: true },
    ],
  },
  {
    slug: 'claude',
    name: 'Claude',
    avatar: `${A}/claude.png`,
    color: '#d97757',
    openrouter: 'anthropic',
    models: [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Основная' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', desc: 'Быстрая', free: true },
    ],
  },
  {
    slug: 'gemini',
    name: 'Gemini',
    avatar: `${A}/gemini.png`,
    color: '#4285f4',
    openrouter: 'google',
    models: [
      { id: 'google/gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', desc: 'Быстрая, мультимодальная', free: true },
      { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', desc: 'Длинный контекст' },
    ],
  },
  {
    slug: 'grok',
    name: 'Grok',
    avatar: `${A}/grok.png`,
    color: '#000000',
    openrouter: 'x-ai',
    models: [
      { id: 'x-ai/grok-2', name: 'Grok 2', desc: 'Основная' },
      { id: 'x-ai/grok-2-mini', name: 'Grok 2 mini', desc: 'Быстрее', free: true },
    ],
  },
  {
    slug: 'deepseek',
    name: 'DeepSeek',
    avatar: `${A}/deepseek.png`,
    color: '#4d6bfe',
    openrouter: 'deepseek',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', desc: 'Общего назначения' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', desc: 'С рассуждением' },
    ],
  },
  {
    slug: 'perplexity',
    name: 'Perplexity',
    avatar: `${A}/perplexity.png`,
    color: '#20808d',
    openrouter: 'perplexity',
    models: [
      { id: 'perplexity/llama-3.1-sonar-large-128k-online', name: 'Sonar Large', desc: 'С поиском в вебе' },
      { id: 'perplexity/llama-3.1-sonar-small-128k-online', name: 'Sonar Small', desc: 'Быстрее, дешевле', free: true },
    ],
  },
  {
    slug: 'qwen',
    name: 'Qwen',
    avatar: `${A}/qwen.png`,
    color: '#6c47ff',
    openrouter: 'qwen',
    models: [
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', desc: 'Универсальная' },
      { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen Coder 32B', desc: 'Для кода' },
    ],
  },
  {
    slug: 'arcee',
    name: 'Arcee',
    avatar: null,
    color: '#7c3aed',
    openrouter: 'arcee-ai',
    models: [
      { id: 'arcee-ai/arcee-blitz', name: 'Arcee Blitz', desc: 'Быстрая' },
    ],
  },
  {
    slug: 'nvidia',
    name: 'NVIDIA',
    avatar: `${A}/nvidea.png`,
    color: '#76b900',
    openrouter: 'nvidia',
    models: [
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', desc: 'Универсальная' },
    ],
  },
  {
    slug: 'meta',
    name: 'Meta AI',
    avatar: `${A}/metaai.png`,
    color: '#0668e1',
    openrouter: 'meta-llama',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', desc: 'Универсальная' },
      { id: 'meta-llama/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', desc: 'С картинками' },
    ],
  },
  {
    slug: 'relace',
    name: 'Relace',
    avatar: null,
    color: '#ea580c',
    openrouter: 'relace',
    models: [
      { id: 'relace/relace-apply-2', name: 'Relace Apply 2', desc: 'Применение патчей' },
    ],
  },
  {
    slug: 'moonshot',
    name: 'Moonshot',
    avatar: null,
    color: '#0891b2',
    openrouter: 'moonshotai',
    models: [
      { id: 'moonshotai/kimi-k2', name: 'Kimi K2', desc: 'Длинный контекст' },
    ],
  },
  {
    slug: 'stepfun',
    name: 'StepFun',
    avatar: null,
    color: '#db2777',
    openrouter: 'stepfun-ai',
    models: [
      { id: 'stepfun-ai/step-3', name: 'Step 3', desc: 'Флагман StepFun' },
    ],
  },
  {
    slug: 'nous',
    name: 'Nous',
    avatar: `${A}/nous.png`,
    color: '#0a0a0a',
    openrouter: 'nousresearch',
    models: [
      { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Hermes 3 405B', desc: 'Флагман' },
      { id: 'nousresearch/hermes-3-llama-3.1-70b', name: 'Hermes 3 70B', desc: 'Компактная', free: true },
    ],
  },
  {
    slug: 'baidu',
    name: 'Baidu',
    avatar: `${A}/baidu.png`,
    color: '#2932e1',
    openrouter: 'baidu',
    models: [
      { id: 'baidu/ernie-4.5-300b-a47b', name: 'ERNIE 4.5', desc: 'Флагман Baidu' },
    ],
  },
]

export function findProvider(slug: string | undefined): ChatProvider | null {
  if (!slug) return null
  return CHAT_PROVIDERS.find((p) => p.slug === slug) ?? null
}
