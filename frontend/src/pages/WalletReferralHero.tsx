import { useState } from 'react'
import Circles from '@/components/react-bits/circles'
import { getUser } from '../lib/telegram'
import './WalletReferralHero.css'
export default function WalletReferralHero(){
 const user=getUser(),[failed,setFailed]=useState(false)
 const name=user?.first_name||'Ваш профиль'
 return <section className="wpay-referral-hero" aria-label="Ваш круг приглашений"><div className="wpay-referral-orbits" aria-hidden="true"><div className="wpay-referral-circles"><Circles earnings={[['+2.40 USDT','+1.80 USDT'],['+5.20 USDT','+0.75 USDT','+3.10 USDT'],['+1.25 USDT','+4.60 USDT','+2.05 USDT','+0.90 USDT']]} /></div></div><div className="wpay-referral-center" aria-label={`Профиль: ${name}`}>
 {user?.photo_url&&!failed?<img src={user.photo_url} alt="" onError={()=>setFailed(true)}/>:<span>{(user?.first_name||'К').slice(0,1).toUpperCase()}</span>}
 </div><div className="wpay-referral-caption"><h2>Ваш круг. Ваши возможности.</h2><p>Пример начислений с приглашённых друзей</p></div></section>
}
