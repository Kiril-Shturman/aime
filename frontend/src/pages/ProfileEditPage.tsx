import { useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import {
  Block,
  BlockTitle,
  Button,
  List,
  ListInput,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
} from 'konsta/react'
import { getUser, haptic } from '../lib/telegram'
import { showCopyToast } from '../components/CopyToast'

// Экран правки профиля: имя, фамилия, ник, e-mail, аватар и «о себе».
// Пока сохраняем в локальный state; когда подключим UserService из
// ai-webapi — тот же вызов через PUT /api/user/{id}.
export default function ProfileEditPage() {
  const nav = useNavigate()
  const tg = getUser()

  const [firstName, setFirstName] = useState(tg?.first_name ?? '')
  const [lastName, setLastName] = useState(tg?.last_name ?? '')
  const [username, setUsername] = useState(tg?.username ?? '')
  const [email, setEmail] = useState('')
  const [bio, setBio] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    tg?.photo_url ?? null,
  )
  const [saving, setSaving] = useState(false)

  const letter = firstName.trim().charAt(0).toUpperCase() || '?'

  const onPickAvatar = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAvatarPreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  const save = async () => {
    if (saving) return
    haptic('light')
    setSaving(true)
    try {
      // TODO: PUT /ai/api/user/{id} через сгенерированный клиент
      await new Promise((r) => setTimeout(r, 500))
      showCopyToast('Сохранено')
      nav(-1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Navbar
        title="Профиль"
        left={
          <NavbarBackLink text="Назад" onClick={() => nav(-1)} />
        }
      />

      <div className="mx-auto w-full max-w-[560px]">
        {/* Аватар с кнопкой камеры поверх */}
        <Block className="!mt-4 !mb-2">
          <div className="flex justify-center">
            <label className="relative cursor-pointer active:opacity-80">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt=""
                  className="w-28 h-28 rounded-full object-cover"
                />
              ) : (
                <div className="w-28 h-28 rounded-full flex items-center justify-center bg-[#2a8bff] text-white text-[44px] font-semibold">
                  {letter}
                </div>
              )}
              <span
                className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-[#2a8bff] text-white
                           flex items-center justify-center shadow-md ring-2 ring-white dark:ring-black"
              >
                <Camera size={17} />
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickAvatar}
              />
            </label>
          </div>
        </Block>

        <BlockTitle>Личные данные</BlockTitle>
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
            label="Ник"
            type="text"
            placeholder="username"
            value={username}
            onChange={(e) =>
              setUsername((e.target as HTMLInputElement).value)
            }
            autoComplete="username"
          />
          <ListInput
            label="E-mail"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            autoComplete="email"
          />
        </List>

        {/* Настройки подписки — как в ai-webapi profile-settings.html:
            две строчки списка со значением и статус-бейджем справа. */}
        <BlockTitle>Настройки подписки</BlockTitle>
        <List strong inset className="[&>ul]:!rounded-[28px]">
          <ListItem
            link
            onClick={() => nav('/tariffs')}
            title="Мой тариф"
            after={
              <span className="inline-flex items-center gap-2">
                <span className="text-[15px] text-black/60 dark:text-white/50">
                  Free
                </span>
                <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full bg-black/40 dark:bg-white/25">
                  Неактивна
                </span>
              </span>
            }
          />
          <ListItem
            link
            onClick={() => nav('/tariffs')}
            title="Способ оплаты"
            after={
              <span className="text-[15px] text-black/60 dark:text-white/50">
                Не указан
              </span>
            }
          />
        </List>

        <BlockTitle>О себе</BlockTitle>
        <List strong inset>
          <ListInput
            type="textarea"
            placeholder="Пара слов о себе — увидят только те, с кем шарите чат"
            value={bio}
            onChange={(e) => setBio((e.target as HTMLInputElement).value)}
          />
        </List>

        <Block>
          <Button
            large
            rounded
            onClick={save}
            disabled={saving}
            className="!h-14"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </Block>
      </div>
    </Page>
  )
}
