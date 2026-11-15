export interface PricePoint { time: number; value: number }
export interface MarketHistory { points: PricePoint[]; source: string; quote: 'USD' | 'USDT'; fetchedAt: number }
export const chartPeriods = [
  {label:'1Д',interval:'5m',minutes:5,count:288,days:1},
  {label:'7Д',interval:'1h',minutes:60,count:168,days:7},
  {label:'1М',interval:'4h',minutes:240,count:180,days:30},
  {label:'1Г',interval:'1d',minutes:1440,count:365,days:365},
  {label:'Все',interval:'1w',minutes:10080,count:1000,days:0},
]
const assets = new Set(['USDT','TRX','BNB','ETH','GRAM','SOL','BTC','XAUT'])
const cache = new Map<string,MarketHistory>()
async function json(url: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort',cancel,{once:true})
  if(signal.aborted)controller.abort()
  const timer = window.setTimeout(cancel,10000)
  try {
    const response = await fetch(url,{signal:controller.signal,credentials:'omit'})
    if(!response.ok)throw Error(`Market data HTTP ${response.status}`)
    return await response.json()
  } finally {window.clearTimeout(timer);signal.removeEventListener('abort',cancel)}
}
function normalize(rows: unknown, timeIndex: number, priceIndex: number, multiplier: number, days: number): PricePoint[] {
  if(!Array.isArray(rows))throw Error('Invalid market data')
  const now=Date.now(), cutoff=days ? now-days*86400000 : 0
  const points=new Map<number,number>()
  for(const row of rows){
    if(!Array.isArray(row))continue
    const time=Number(row[timeIndex])*multiplier,value=Number(row[priceIndex])
    if(Number.isFinite(time)&&Number.isFinite(value)&&value>0&&time>=cutoff&&time<=now+60000)points.set(time,value)
  }
  const sorted=[...points].sort((a,b)=>a[0]-b[0]).map(([time,value])=>({time,value}))
  if(sorted.length<2)throw Error('Not enough price history')
  return sorted
}
export async function getMarketHistory(code: string, period: number, signal: AbortSignal): Promise<MarketHistory> {
  if(!assets.has(code)||!chartPeriods[period])throw Error('Unsupported asset or period')
  const key=`${code}:${period}`, existing=cache.get(key)
  if(existing && Date.now()-existing.fetchedAt<60000)return existing
  const range=chartPeriods[period]
  let points: PricePoint[], source: string, quote: MarketHistory['quote']='USDT'
  if(code==='USDT'){
    const data=await json(`https://api.kraken.com/0/public/OHLC?pair=USDTUSD&interval=${range.minutes}`,signal) as {error?:unknown[];result?:Record<string,unknown>}
    if(data.error?.length||!data.result)throw Error('Kraken data unavailable')
    const rows=Object.entries(data.result).find(([key,value])=>key!=='last'&&Array.isArray(value))?.[1]
    points=normalize(rows,0,4,1000,range.days);source='Kraken';quote='USD'
  }else{
    const gate=async()=>{
      const interval=range.interval==='1w'?'7d':range.interval
      return normalize(await json(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${code}_USDT&interval=${interval}&limit=${range.count}`,signal),0,2,1000,range.days)
    }
    if(code==='GRAM'||code==='XAUT') {points=await gate();source='Gate'}
    else {
      try {points=normalize(await json(`https://data-api.binance.vision/api/v3/klines?symbol=${code}USDT&interval=${range.interval}&limit=${range.count}`,signal),0,4,1,range.days);source='Binance'}
      catch(error){if(signal.aborted)throw error;points=await gate();source='Gate'}
    }
  }
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  const history={points,source,quote,fetchedAt:Date.now()}
  cache.set(key,history)
  return history
}

// Current quotes are separate from wallet connectivity and financial balances.
export async function getMarketUsdRates(signal: AbortSignal): Promise<Record<string,number>> {
  const major=['BTC','ETH','BNB','SOL','TRX','TON']
  const binanceSymbols=encodeURIComponent(JSON.stringify(major.map(code=>`${code}USDT`)))
  const gate=(code:string)=>json(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${code}_USDT`,signal)
  const results=await Promise.allSettled([
    json(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${binanceSymbols}`,signal),
    gate('GRAM'),gate('XAUT'),json('https://api.kraken.com/0/public/Ticker?pair=USDTUSD',signal),
  ])
  const quote: Record<string,number>={}
  const valid=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null}
  const first=results[0]
  if(first.status==='fulfilled'&&Array.isArray(first.value))for(const row of first.value){
    if(!row||typeof row.symbol!=='string')continue
    const code=row.symbol.replace(/USDT$/,''),price=valid(row.price)
    if(major.includes(code)&&price!==null)quote[code]=price
  }
  for(const [index,code] of [[1,'GRAM'],[2,'XAUT']] as const){
    const response=results[index]
    if(response.status==='fulfilled'&&Array.isArray(response.value)){
      const row=response.value.find(item=>item.currency_pair===`${code}_USDT`),price=valid(row?.last)
      if(price!==null)quote[code]=price
    }
  }
  const dollar=results[3]
  let usdtUsd: number|null=null
  if(dollar.status==='fulfilled'&&dollar.value&&typeof dollar.value==='object'){
    const data=dollar.value as {error?:unknown[];result?:Record<string,{c?:unknown[]}>}
    if(!data.error?.length&&data.result)usdtUsd=valid(Object.values(data.result)[0]?.c?.[0])
  }
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  if(usdtUsd===null)return {}
  // Preserve the true USD quote rather than treating 1 USDT as exactly 1 USD.
  return {USDT:usdtUsd,...Object.fromEntries(Object.entries(quote).map(([code,value])=>[code,value*usdtUsd!]))}
}
