import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Mail } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
} from 'konsta/react'
import {
  clearGmail,
  fetchGmailProfile,
  getGmail,
  isGmailConfigured,
  requestGmailToken,
  saveGmail,
} from '../lib/gmail'
import { haptic } from '../lib/telegram'
import { showCopyToast } from '../components/CopyToast'

// Экран подключения Gmail: OAuth через Google Identity Services,
// токен и email сохраняются локально под ключом проекта. Открывается
// из меню «трёх точек» на странице проекта: /connect/gmail?project=<id>.
export default function GmailConnectPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const projectId = params.get('project') ?? ''

  const [account, setAccount] = useState(() =>
    projectId ? getGmail(projectId) : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goBack = () =>
    navigate(projectId ? `/project/${projectId}` : -1)

  const connect = async () => {
    if (busy || !projectId) return
    setBusy(true)
    setError(null)
    try {
      haptic('light')
      const { accessToken, expiresIn } = await requestGmailToken()
      const profile = await fetchGmailProfile(accessToken)
      const acc = {
        accessToken,
        email: profile.emailAddress,
        expiresAt: Date.now() + expiresIn * 1000,
      }
      saveGmail(projectId, acc)
      setAccount(acc)
      haptic('success')
      showCopyToast('Gmail подключён')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = () => {
    if (!projectId) return
    clearGmail(projectId)
    setAccount(null)
    haptic('warning')
  }

  return (
    <Page className="pb-safe-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Gmail-почта"
        left={<NavbarBackLink text="Проект" onClick={goBack} />}
      />

      <div className="mx-auto w-full max-w-[560px]">
        <Block className="!mt-4 flex flex-col items-center text-center gap-3">
          <span className="w-16 h-16 rounded-full bg-[#ea4335]/12 text-[#ea4335] flex items-center justify-center">
            <Mail size={28} />
          </span>
          <div className="text-[19px] font-semibold text-black dark:text-white">
            Подключить Gmail
          </div>
          <p className="text-[14px] text-black/60 dark:text-white/50 max-w-[400px]">
            Агент будет читать письма как контекст: счета, переписку с
            клиентами, важные уведомления. Мы просим только права на чтение —
            отправлять или удалять письма от вашего имени не сможем.
          </p>
        </Block>

        <BlockTitle>Что получаем</BlockTitle>
        <List strong inset>
          <ListItem
            media={<Check size={18} className="text-[#2a8bff]" />}
            title="Только чтение писем"
            subtitle="Скоуп gmail.readonly — ни отправки, ни удаления."
          />
          <ListItem
            media={<Check size={18} className="text-[#2a8bff]" />}
            title="Логин через Google"
            subtitle="Пароль вводите на google.com — мы его не видим."
          />
          <ListItem
            media={<Check size={18} className="text-[#2a8bff]" />}
            title="Отключается в один клик"
            subtitle="Токен хранится локально и стирается кнопкой ниже."
          />
        </List>

        {account ? (
          <>
            <BlockTitle>Подключён аккаунт</BlockTitle>
            <List strong inset>
              <ListItem
                media={
                  <span className="w-10 h-10 rounded-full bg-[#ea4335]/12 text-[#ea4335] flex items-center justify-center">
                    <Mail size={18} />
                  </span>
                }
                title={account.email}
                subtitle="Готов принимать письма как контекст"
              />
            </List>
            <Block>
              <Button
                large
                rounded
                outline
                onClick={disconnect}
                className="!h-14"
              >
                Отключить
              </Button>
            </Block>
          </>
        ) : (
          <Block>
            {!isGmailConfigured() && (
              <p className="text-[13px] text-red-500 mb-3 leading-snug">
                Не задан <code>VITE_GOOGLE_CLIENT_ID</code>. Заведи
                OAuth-клиент в Google Cloud Console (тип «Web application»,
                добавь текущий origin в Authorized JavaScript origins) и
                положи ID в файл <code>.env</code>. После этого кнопка
                заработает.
              </p>
            )}
            <Button
              large
              rounded
              onClick={connect}
              disabled={busy || !isGmailConfigured() || !projectId}
              className="!h-14"
            >
              {busy ? 'Открываем окно Google…' : 'Подключить через Google'}
            </Button>
            {error && (
              <p className="text-[13px] text-red-500 mt-3 text-center">
                {error}
              </p>
            )}
            {!projectId && (
              <p className="text-[13px] text-black/50 dark:text-white/40 mt-3 text-center">
                Открой эту страницу из меню проекта — так мы поймём, к
                какому проекту подключаем почту.
              </p>
            )}
          </Block>
        )}
      </div>
    </Page>
  )
}
