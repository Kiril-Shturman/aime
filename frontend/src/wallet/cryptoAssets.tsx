import { SiBitcoin, SiBnbchain, SiEthereum, SiSolana, SiTether, SiTon } from "@icons-pack/react-simple-icons";
import { currencyNames } from "./catalog";
import type { Asset } from "./appearance";

export const cryptoAssets: Asset[] = [
  {
    code: "USDT",
    name: currencyNames.USDT,
    rate: "",
    color: "#26A17B",
    iconColor: "#fff",
    icon: <SiTether size={25} />,
  },
  {
    code: "TRX",
    name: currencyNames.TRX,
    rate: "",
    color: "#ef0027",
    iconColor: "#fff",
    icon: (
      <svg
        viewBox="0 0 32 32"
        width="25"
        height="25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d="M4 4 28 9 14 29 4 4Z M4 4 17 12 28 9 M17 12 14 29 M17 12 23 8" />
      </svg>
    ),
  },
  {
    code: "BNB",
    name: currencyNames.BNB,
    rate: "",
    color: "#F3BA2F",
    iconColor: "#fff",
    icon: <SiBnbchain size={25} />,
  },
  {
    code: "ETH",
    name: currencyNames.ETH,
    rate: "",
    color: "#627EEA",
    iconColor: "#fff",
    icon: <SiEthereum size={25} />,
  },
  {
    code: "GRAM",
    name: currencyNames.GRAM,
    rate: "",
    color: "#0098EA",
    iconColor: "#fff",
    icon: <SiTon size={25} />,
  },
  {
    code: "SOL",
    name: currencyNames.SOL,
    rate: "",
    color: "#111",
    iconColor: "#14F195",
    icon: <SiSolana size={25} />,
  },
  {
    code: "BTC",
    name: currencyNames.BTC,
    rate: "",
    color: "#F7931A",
    iconColor: "#fff",
    icon: <SiBitcoin size={25} />,
  },
  {
    code: "XAUT",
    name: currencyNames.XAUT,
    rate: "",
    color: "#c89b43",
    iconColor: "#fff",
    icon: <SiTether size={25} />,
  },
];

export const cryptoAssetsByTicker = Object.fromEntries(cryptoAssets.map((asset) => [asset.code, asset]));
