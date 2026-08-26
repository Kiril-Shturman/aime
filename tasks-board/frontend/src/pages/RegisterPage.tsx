import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Block, Button, List, ListInput, Page, Preloader } from 'konsta/react'
import LangSwitch from '../components/LangSwitch'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    if (!firstName.trim()) return setError('Введи имя')
    if (!lastName.trim()) return setError('Введи фамилию')
    if (!email.trim()) return setError('Введи почту')
    if (!isEmail(email)) return setError('Похоже, в почте опечатка')
    if (password.length < 8) return setError('Пароль от 8 символов')
    if (password !== confirm) return setError('Пароли не совпадают')
    setLoading(true)
    try {
      // TODO: POST /ai/api/auth/register через сгенерированный клиент
      await new Promise((r) => setTimeout(r, 600))
      setError('Бэк ещё не подключён')
    } finally {
      setLoading(false)
    }
  }

  const oauth = (provider: 'google' | 'yandex' | 'max') => {
    setError(`Регистрация через ${provider} пока не подключена`)
  }

  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <LangSwitch className="absolute top-4 right-4 z-30" />
      <div className="min-h-full flex flex-col">
        <div className="w-full max-w-[440px] mx-auto px-4 pt-12 flex-1 flex flex-col">
          <div className="flex justify-center mb-6">
            <img
              src="/auth/logo-strokablack.svg"
              alt="aiStore"
              className="h-12 dark:hidden"
            />
            <img
              src="/auth/logo-strokawhite.svg"
              alt="aiStore"
              className="h-12 hidden dark:block"
            />
          </div>

          <h1 className="text-[28px] leading-tight font-extrabold text-center text-black dark:text-white">
            Создать аккаунт
          </h1>
          <p className="text-[15px] leading-snug text-center text-black/60 dark:text-white/55 mt-3 mb-6">
            Присоединяйтесь к aiStore и получите доступ ко всем функциям
            искусственного интеллекта.
          </p>

          <form onSubmit={submit} noValidate>
            <List strong inset>
              <ListInput
                label="Имя"
                type="text"
                placeholder="Иван"
                value={firstName}
                onChange={(e) =>
                  setFirstName((e.target as HTMLInputElement).value)
                }
                autoComplete="given-name"
              />
              <ListInput
                label="Фамилия"
                type="text"
                placeholder="Иванов"
                value={lastName}
                onChange={(e) =>
                  setLastName((e.target as HTMLInputElement).value)
                }
                autoComplete="family-name"
              />
              <ListInput
                label="Электронная почта"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                autoComplete="email"
              />
            </List>

            <div className="relative">
              <List strong inset>
                <ListInput
                  label="Пароль"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Не короче 8 символов"
                  value={password}
                  onChange={(e) =>
                    setPassword((e.target as HTMLInputElement).value)
                  }
                  autoComplete="new-password"
                />
                <ListInput
                  label="Повтори пароль"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="•••••••"
                  value={confirm}
                  onChange={(e) =>
                    setConfirm((e.target as HTMLInputElement).value)
                  }
                  autoComplete="new-password"
                />
              </List>
              {password.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-8 top-[calc(50%-1.75rem)] -translate-y-1/2 z-20 p-2 -m-2 text-black/45 dark:text-white/45"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              )}
              {confirm.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-8 bottom-6 z-20 p-2 -m-2 text-black/45 dark:text-white/45"
                >
                  {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              )}
            </div>

            {error && (
              <Block className="!mt-2 !mb-0">
                <p className="text-[14px] text-[#ff3b30] text-center">
                  {error}
                </p>
              </Block>
            )}

            <Block>
              {loading ? (
                <div className="h-14 flex items-center justify-center">
                  <Preloader
                    colors={{ iconIos: 'text-black/45 dark:text-white/45' }}
                  />
                </div>
              ) : (
                <Button
                  type="submit"
                  large
                  rounded
                  className="!h-14"
                >
                  Зарегистрироваться
                </Button>
              )}

              <div className="text-center text-[15px] mt-4 text-black dark:text-white">
                <span className="opacity-70">Уже есть аккаунт?</span>{' '}
                <a
                  onClick={() => navigate('/login')}
                  className="text-[#2a8bff] font-medium cursor-pointer"
                >
                  Войти
                </a>
              </div>
            </Block>
          </form>

          <div className="flex items-center gap-3 my-4 px-4 text-[13px] text-black/45 dark:text-white/40">
            <span className="flex-1 h-px bg-black/10 dark:bg-white/10" />
            <span>ИЛИ</span>
            <span className="flex-1 h-px bg-black/10 dark:bg-white/10" />
          </div>

          <div className="px-4 flex flex-col gap-3">
            <SocialButton
              logo="/auth/Google-logo.png"
              label="Продолжить с Google"
              onClick={() => oauth('google')}
              disabled={loading}
            />
            <SocialButton
              logo="/auth/Yandex-logo.png"
              label="Продолжить с Яндекс"
              onClick={() => oauth('yandex')}
              disabled={loading}
            />
            <SocialButton
              logo="/auth/MAX-logo.svg"
              label="Продолжить с MAX"
              onClick={() => oauth('max')}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col items-center gap-3 mt-auto pt-14 pb-10 text-[13px]">
            <a
              className="text-black/45 dark:text-white/40 underline cursor-pointer"
              onClick={() => navigate('/terms')}
            >
              Условия использования
            </a>
            <a
              className="text-black/45 dark:text-white/40 underline cursor-pointer"
              onClick={() => navigate('/privacy')}
            >
              Политика конфиденциальности
            </a>
          </div>
        </div>
      </div>
    </Page>
  )
}

function SocialButton({
  logo,
  label,
  onClick,
  disabled,
}: {
  logo: string
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative w-full h-14 rounded-full bg-white text-[16px] font-medium text-black flex items-center justify-center transition active:scale-[0.99] disabled:opacity-60"
    >
      <img
        src={logo}
        alt=""
        className="absolute left-5 w-6 h-6 object-contain"
      />
      <span>{label}</span>
    </button>
  )
}
