import { useLocation, useNavigate } from 'react-router-dom'
import { Tabbar, TabbarLink, ToolbarPane } from 'konsta/react'
import { getUser, haptic } from '../lib/telegram'

// SVG-иконки взяты из ai-webapi (assets/images/today.svg и search.svg).
// Заменили fill/stroke на currentColor чтобы менялся вместе с темой.
const TodayIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 304 379"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M80.8191 90.8185H223.358C229.724 90.8185 234.323 86.0479 234.323 79.8637C234.323 73.8563 229.724 69.0857 223.358 69.0857H80.8191C74.2757 69.0857 69.6778 73.8563 69.6778 79.8637C69.6778 86.0479 74.2757 90.8185 80.8191 90.8185ZM80.8191 142.058H164.468C170.658 142.058 175.432 137.288 175.432 131.104C175.432 125.096 170.658 120.326 164.468 120.326H80.8191C74.2757 120.326 69.6778 125.096 69.6778 131.104C69.6778 137.288 74.2757 142.058 80.8191 142.058ZM83.4719 316.981H214.162C229.724 316.981 237.683 309.031 237.683 293.481V195.242C237.683 179.693 229.724 171.566 214.162 171.566H83.4719C68.4399 171.566 59.7743 179.693 59.7743 195.242V293.481C59.7743 309.031 68.4399 316.981 83.4719 316.981ZM0 323.52C0 360.447 18.2153 378.823 54.8225 378.823H242.634C279.241 378.823 297.457 360.447 297.457 323.52V55.4806C297.457 18.7292 279.241 0 242.634 0H54.8225C18.2153 0 0 18.7292 0 55.4806V323.52ZM28.4725 322.989V56.0106C28.4725 38.3416 37.8452 28.4471 56.2374 28.4471H241.219C259.611 28.4471 268.984 38.3416 268.984 56.0106V322.989C268.984 340.657 259.611 350.375 241.219 350.375H56.2374C37.8452 350.375 28.4725 340.657 28.4725 322.989Z" />
  </svg>
)

const GenerateIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 345 366"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M173.123 344.815C179.788 344.815 185.024 340.052 186.453 332.908C207.402 225.749 221.687 202.412 332.624 186.219C340.239 185.267 345.002 179.551 345.002 172.884C345.002 165.263 340.239 159.548 332.624 158.596C221.687 142.403 202.644 116.685 186.453 12.8591C185.024 4.76263 179.788 0 173.123 0C165.508 0 160.266 4.76263 158.838 12.3828C137.893 118.59 123.608 142.403 13.1496 158.596C5.05143 159.548 0.292969 165.263 0.292969 172.884C0.292969 179.551 5.05143 184.79 13.1496 186.219C123.608 202.412 142.174 225.749 158.838 332.432C159.793 340.052 164.552 344.815 173.123 344.815Z" />
    <path d="M50.6257 361.174C53.2995 361.174 55.0822 359.39 55.4387 356.891C60.7865 323.328 60.7865 320.829 97.1514 315.117C99.6469 314.76 101.43 313.153 101.43 310.475C101.43 307.797 99.6469 306.19 97.1514 305.834C60.7865 300.121 60.7865 297.622 55.4387 264.06C55.0822 261.561 53.2995 259.775 50.6257 259.775C48.13 259.775 46.3474 261.561 45.9909 264.06C40.6431 297.622 40.6431 300.121 4.27822 305.834C1.78259 306.19 0 307.797 0 310.475C0 313.153 1.78259 314.76 4.27822 315.117C40.6431 320.829 40.6431 323.328 45.9909 356.891C46.3474 359.39 48.13 361.174 50.6257 361.174Z" />
    <path d="M297.621 76.3378C299.76 76.3378 301.187 74.731 301.721 72.5904C304.93 52.7744 304.039 51.8805 326.678 47.7747C328.817 47.2391 330.243 45.6322 330.243 43.6689C330.243 41.7056 328.817 39.9196 326.678 39.5631C304.217 35.4573 305.287 34.9217 301.721 14.5702C301.187 12.6069 299.582 11 297.621 11C295.482 11 294.056 12.6069 293.521 14.9285C289.243 34.9217 291.026 35.9929 268.743 39.5631C266.426 39.9196 265 41.5265 265 43.6689C265 45.6322 266.426 47.2391 268.565 47.7747C291.026 51.8805 289.243 52.7744 293.521 72.5904C294.056 74.731 295.482 76.3378 297.621 76.3378Z" />
  </svg>
)

function ProfileIcon({ className = '' }: { className?: string }) {
  const user = getUser()
  const letter =
    (user?.first_name || 'Г').trim().charAt(0).toUpperCase() || '?'
  if (user?.photo_url) {
    return (
      <img
        src={user.photo_url}
        alt=""
        className={`${className} rounded-full object-cover`}
      />
    )
  }
  return (
    <span
      className={`${className} rounded-full bg-[#2a8bff] text-white text-[11px] font-semibold flex items-center justify-center`}
    >
      {letter}
    </span>
  )
}

export default function TabPill() {
  const nav = useNavigate()
  const { pathname } = useLocation()

  const active = pathname.startsWith('/profile')
    ? 'profile'
    : pathname.startsWith('/generate')
      ? 'generate'
      : 'today'

  const go = (to: string) => {
    haptic('light')
    nav(to)
  }

  return (
    <Tabbar
      labels
      icons
      className="!fixed !left-0 !right-0 !bottom-0 !w-full z-30"
    >
      <ToolbarPane>
        <TabbarLink
          active={active === 'today'}
          onClick={() => go('/')}
          icon={<TodayIcon className="w-6 h-6" />}
          label="Сегодня"
        />
        <TabbarLink
          active={active === 'generate'}
          onClick={() => go('/generate')}
          icon={<GenerateIcon className="w-6 h-6" />}
          label="Нейросети"
        />
        <TabbarLink
          active={active === 'profile'}
          onClick={() => go('/profile')}
          icon={<ProfileIcon className="w-6 h-6" />}
          label="Профиль"
        />
      </ToolbarPane>
    </Tabbar>
  )
}
