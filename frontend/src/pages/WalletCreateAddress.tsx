import { useEffect, useRef, useState, type ReactNode } from 'react'
import { f7, List, ListItem } from 'framework7-react'
import 'framework7/components/dialog/css'
import { Button } from 'konsta/react'
import WalletNetworkIcon from './WalletNetworkIcon'
import './WalletAddressCheckbox.css'
import { addressNetworkNames, addressNetworkStandards } from './WalletAddressDetails'

export default function WalletCreateAddress({code,networks,icon,color,iconColor}:{code:string;networks:string[];icon:ReactNode;color:string;iconColor:string}){
 const [selected,setSelected]=useState<string[]>([]),[paymentError,setPaymentError]=useState('')
 const confirmation=useRef<ReturnType<typeof f7.dialog.create>|null>(null)
 useEffect(()=>()=>{confirmation.current?.close(false);confirmation.current=null},[])
 const price=2,total=selected.length*price
 const money=(amount:number)=>amount.toLocaleString('en-US',{style:'currency',currency:'USD'})
 function confirmPayment(){
  if(!selected.length||confirmation.current)return
  confirmation.current=f7.dialog.create({
   title:'Подтвердить оплату',
   text:`Адресов: ${selected.length}<br/>Сети: ${selected.map(network=>addressNetworkNames[network]??network).join(', ')}<br/><br/>Итого: <strong>${money(total)}</strong>`,
   cssClass:'wpay-address-confirm',destroyOnClose:true,
   buttons:[{text:'Отмена',keyCodes:[27]},{text:'Оплатить',strong:true,keyCodes:[13],onClick:()=>setPaymentError('Оплата дополнительных адресов пока не подключена. Средства не списаны.')}],
   on:{closed:()=>{confirmation.current=null}},
  })
  confirmation.current.open()
 }
 function toggle(network:string,checked:boolean){setPaymentError('');setSelected(previous=>checked?[...new Set([...previous,network])]:previous.filter(item=>item!==network))}
 return <div className="wpay-paid-address-content flex min-h-0 flex-1 flex-col">
  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
  <fieldset className="m-0 min-w-0 border-0 p-0"><legend className="sr-only">Выберите сети для дополнительных адресов</legend>
   <List strong inset dividers mediaList className="wpay-paid-address-list !mx-0 !my-0 overflow-hidden !rounded-[30px]">{networks.map(network=><ListItem key={network} checkbox name="additional-address-networks" value={network} checked={selected.includes(network)} onChange={(event)=>toggle(network,(event.target as HTMLInputElement).checked)} title={code+(!['BTC','TRX'].includes(code)?' · '+(addressNetworkStandards[network]??network):'')} subtitle={addressNetworkNames[network]??network}>
    <span slot="media" className="wpay-address-avatar"><span className="wpay-currency-icon flex h-11 w-11 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6" style={{color:iconColor,backgroundColor:color,backgroundImage:`linear-gradient(180deg,color-mix(in srgb,${color} 62%,white),${color})`}}>{icon}</span><span className="wpay-address-network-badge"><WalletNetworkIcon network={network}/></span></span>
   </ListItem>)}</List>
  </fieldset>
  {!networks.length&&<p className="py-6 text-center text-[15px] text-black/50 dark:text-white/50">Дополнительные адреса для этой валюты пока недоступны.</p>}
  {selected.length>0&&<section aria-label="Расчёт стоимости адресов" className="mt-5">
   <h3 className="mb-3 px-2 text-[16px] font-semibold text-black/50 dark:text-white/50">Стоимость адресов</h3>
   <div className="rounded-[28px] bg-white p-5 dark:bg-[#2c2c2e]">
   <dl className="space-y-3 text-[15px]"><div className="flex items-center justify-between gap-3"><dt className="text-black/45 dark:text-white/45">Выбрано адресов</dt><dd className="font-medium tabular-nums text-black dark:text-white">{selected.length}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-black/45 dark:text-white/45">За один адрес</dt><dd className="font-medium tabular-nums text-black dark:text-white">{money(price)}</dd></div><div className="flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.08]"><dt className="text-[17px] font-semibold text-black dark:text-white">Итого</dt><dd aria-label="Итоговая стоимость" className="text-[24px] font-semibold tabular-nums text-black dark:text-white">{money(total)}</dd></div></dl>

   {paymentError&&<p role="status" className="mt-3 text-[13px] leading-5 text-black/50 dark:text-white/50">{paymentError}</p>}
   </div>
  </section>}
  </div>
  {selected.length>0&&<div className="shrink-0 px-4 pb-[max(8px,env(safe-area-inset-bottom,0px))] pt-3"><Button data-wpay-primary="" rounded className="!m-0 !w-full" onClick={confirmPayment}>Оплатить</Button></div>}
 </div>
}
