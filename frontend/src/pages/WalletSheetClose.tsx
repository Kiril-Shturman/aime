import './WalletSheetClose.css'
export default function WalletSheetClose({onClick,label='Закрыть'}:{onClick:()=>void;label?:string}){
 return <button type="button" aria-label={label} onClick={onClick} className="wpay-sheet-close"><i aria-hidden="true" className="icon icon-close"/></button>
}
