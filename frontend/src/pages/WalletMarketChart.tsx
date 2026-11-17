import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from 'konsta/react'
import { chartPeriods, getMarketHistory, type MarketHistory } from '../lib/market-data'
export { chartPeriods }
const L=3,T=14
const number = (value:number) => value.toLocaleString('en-US',{maximumFractionDigits:value>=1000?2:value>=1?4:6})
const date = (time:number) => new Date(time).toLocaleString('ru-RU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
export default function WalletMarketChart({code,period,active=true,icon,onPeriodChange}: {code:string;period:number;active?:boolean;icon?:ReactNode;onPeriodChange?:(percent:number|null)=>void}) {
  const [data,setData]=useState<MarketHistory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0),[selected,setSelected]=useState<number|null>(null)
  const finger=useRef(false)
  const chartRef = useRef<HTMLElement>(null)
  const [desktopWidth, setDesktopWidth] = useState(0)
  const W = desktopWidth || 360
  const H = desktopWidth ? 280 : 207
  const R = W - 3
  const B = H - 16

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !active) return
    const media = window.matchMedia("(min-width: 1100px)")
    const resize = () => setDesktopWidth(media.matches ? Math.round(chart.clientWidth) : 0)
    const observer = new ResizeObserver(resize)
    observer.observe(chart)
    media.addEventListener("change", resize)
    resize()
    return () => {
      observer.disconnect()
      media.removeEventListener("change", resize)
    }
  }, [active])

  const gradient=useId().replace(/:/g,'')
  useEffect(()=>{
    if(!active){setSelected(null);return}
    const controller=new AbortController()
    setData(null);setSelected(null);setError('');setLoading(true)
    getMarketHistory(code,period,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(()=>{if(!controller.signal.aborted)setError('Не удалось загрузить котировки. Проверьте соединение и повторите.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[code,period,attempt,active])
  const points=data?.points ?? [],first=points[0],last=points.at(-1),point=points[selected??points.length-1]
  const prices=points.map(p=>p.value),min=Math.min(...prices),max=Math.max(...prices),padding=(max-min)*.1 || max*.001 || .01
  const low=min-padding,high=max+padding
  const tickDecimals=Math.min(8,Math.max(0,Math.ceil(-Math.log10((high-low)/3))+1))
  const x=(i:number)=>L+i/Math.max(1,points.length-1)*(R-L)
  const y=(value:number)=>B-(value-low)/(high-low)*(B-T)
  const line=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')
  const difference=first&&point?point.value-first.value:0,percent=first?difference/first.value*100:0
  useEffect(()=>{
    onPeriodChange?.(first&&point&&first.value>0?percent:null)
  },[first,point,percent,onPeriodChange])
  const positive=difference>=0
  function inspect(clientX:number,svg:SVGSVGElement){
    const rect=svg.getBoundingClientRect(),local=(clientX-rect.left)/rect.width*W
    setSelected(Math.max(0,Math.min(points.length-1,Math.round((local-L)/(R-L)*(points.length-1)))))
  }
  function end(){finger.current=false;setSelected(null)}
  return <section ref={chartRef} aria-label={`Рыночный график ${code}`} aria-busy={loading} className="mt-2">
    <p aria-live="off" className="text-[31px] font-semibold leading-tight tracking-tight tabular-nums text-black dark:text-white">{point?`${number(point.value)} ${data?.quote}`:'—'}</p>
    <div className="mt-2 flex min-h-6 items-center gap-2 text-[13px]">
      {point&&first?<><span className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium tabular-nums ${positive?'bg-green-500/10 text-green-600 dark:bg-green-400/10 dark:text-green-400':'bg-red-500/10 text-red-500 dark:bg-red-400/10 dark:text-red-400'}`}>{positive?'+':''}{percent.toFixed(2)}%</span><span className="min-w-0 truncate text-black/40 dark:text-white/40">{selected!==null?date(point.time):`За период · ${chartPeriods[period].label}`}</span></>:<span role="status" className="text-black/40 dark:text-white/40">{loading?'Загружаем котировки…':error?'Котировки недоступны':''}</span>}
      <span aria-label="Торговая пара" className="relative ml-auto shrink-0 whitespace-nowrap text-[12px] text-black/45 dark:text-white/45">{code}/{data?.quote ?? (code==='USDT'?'USD':'USDT')}{icon && <span className="absolute right-0 bottom-[calc(100%+16px)]">{icon}</span>}</span>
    </div>
    {data&&first&&last&&points.length>1?<>
      <svg role="slider" tabIndex={0} aria-label={`Цена ${code} по времени`} aria-valuemin={0} aria-valuemax={points.length-1} aria-valuenow={selected??points.length-1} aria-valuetext={point?`${date(point.time)}, ${number(point.value)} ${data.quote}`:undefined} viewBox={`0 0 ${W} ${H}`} style={{touchAction:'pan-y'}} className={`mt-3 block w-full select-none outline-offset-4 ${positive?'text-green-500 dark:text-green-400':'text-red-500 dark:text-red-400'}`} onPointerDown={e=>{finger.current=true;e.currentTarget.setPointerCapture(e.pointerId);inspect(e.clientX,e.currentTarget)}} onPointerMove={e=>{if(e.pointerType==='mouse'||finger.current)inspect(e.clientX,e.currentTarget)}} onPointerUp={e=>{e.currentTarget.releasePointerCapture(e.pointerId);end()}} onPointerCancel={end} onPointerLeave={()=>{if(!finger.current)setSelected(null)}} onBlur={end} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape'){setSelected(null);return}setSelected(i=>e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(i??points.length-1)+(e.key==='ArrowLeft'?-1:1))))}}}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".12"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
        {[0,1,2,3].map(i=>{const yy=T+(B-T)*i/3;return <line key={i} x1={L} x2={R} y1={yy} y2={yy} className="stroke-black/[.07] dark:stroke-white/10" strokeWidth="1"/>})}
        <path d={`${line} L${R},${B} L${L},${B} Z`} fill={`url(#${gradient})`}/><path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
        {[0,1,2,3].map(i=>{const value=high-(high-low)*i/3,yy=T+(B-T)*i/3;const label=new Intl.NumberFormat('en-US',{notation:value>=1000?'compact':'standard',maximumFractionDigits:value>=1000?1:tickDecimals}).format(value).replace(/\s/g,'').replace('тыс.','к').replace('млн','м');return <text key={i} data-price-tick x={R-2} y={yy-4} textAnchor="end" fontSize="9" paintOrder="stroke" strokeWidth="3" strokeLinejoin="round" pointerEvents="none" className="fill-black/40 stroke-white dark:fill-white/40 dark:stroke-[#1c1c1e]">{label}</text>})}
        {selected!==null&&point&&<g><line x1={x(selected)} x2={x(selected)} y1={T} y2={B} stroke="currentColor" opacity=".4" strokeDasharray="3 3"/><line x1={L} x2={R} y1={y(point.value)} y2={y(point.value)} stroke="currentColor" opacity=".2" strokeDasharray="3 3"/><circle cx={x(selected)} cy={y(point.value)} r="4" fill="currentColor" stroke="white" strokeWidth="2"/></g>}
        <text x={L} y={H-2} fontSize="10" className="fill-black/35 dark:fill-white/35">{new Date(first.time).toLocaleDateString('ru-RU',{day:'numeric',month:'short',...(period===4?{year:'numeric'}:{})})}</text>
        <text x={R} y={H-2} textAnchor="end" fontSize="10" className="fill-black/35 dark:fill-white/35">{new Date(last.time).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</text>
      </svg>
      <p className="mt-2 text-[11px] text-black/35 dark:text-white/35">{data.source} · история биржи</p>
    </>:<div className="flex min-h-[230px] items-center justify-center rounded-2xl">{error?<div role="alert" className="max-w-[280px] text-center text-[14px] leading-relaxed text-black/50 dark:text-white/50"><p>{error}</p><Button inline clear rounded onClick={()=>setAttempt(n=>n+1)}>Повторить</Button></div>:<div className="h-32 w-full animate-pulse rounded-2xl bg-black/[.035] motion-reduce:animate-none dark:bg-white/5"/>}</div>}
  </section>
}
