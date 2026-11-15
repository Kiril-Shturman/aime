import { SiBinance, SiBitcoin, SiEthereum, SiSolana } from '@icons-pack/react-simple-icons'
import './WalletNetworkIcon.css'
export default function WalletNetworkIcon({network}:{network:string}){
 return <span className={`wpay-network-icon wpay-network-icon--${network.toLowerCase()}`} aria-hidden="true">{network==='BTC'?<SiBitcoin size={25}/>:network==='BSC'?<SiBinance size={25}/>:network==='ETH'?<SiEthereum size={27}/>:network==='SOL'?<SiSolana size={24}/>:network==='TON'?<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M7 6h18c2 0 3 2 2 4L16 27 5 10C4 8 5 6 7 6Z M16 6v21"/></svg>:<svg viewBox="0 0 32 32" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="m5 5 23 5-14 19L5 5Zm0 0 13 8 10-3M18 13l-4 16M18 13l6-4"/></svg>}</span>
}
