/** Display support and provider capabilities are deliberately separate. */
export const networkNames: Record<string, string> = {
  BSC: "BNB Smart Chain",
  ETH: "Ethereum",
  TON: "TON",
  SOL: "Solana",
  TRON: "Tron",
  BTC: "Bitcoin",
};
export const networkStandards: Record<string, string> = {
  BSC: "BEP20",
  ETH: "ERC20",
  TON: "TON",
  SOL: "SPL",
  TRON: "TRC20",
  BTC: "BTC",
};
export const assetNetworks: Record<string, string[]> = {
  USDT: ["BSC", "ETH", "TON", "SOL", "TRON"],
  TRX: ["TRON"],
  BNB: ["BSC"],
  ETH: ["ETH"],
  GRAM: ["TON"],
  SOL: ["SOL"],
  BTC: ["BTC"],
  XAUT: ["ETH"],
};
export const depositNetworks: Record<string, string[]> = {
  USDT: assetNetworks.USDT,
  ETH: ["ETH"],
  BNB: ["BSC"],
  SOL: ["SOL"],
};
// getClientAddress is a network-level USDT endpoint, not an asset-specific deposit.
export const permanentAddressNetworks: Record<string, string[]> = {
  USDT: ["BSC", "ETH", "TON", "SOL"],
};
export const currencyNames: Record<string, string> = {
  USDT: "Tether",
  TRX: "TRON",
  BNB: "Binance Coin",
  ETH: "Ethereum",
  GRAM: "Gram",
  SOL: "Solana",
  BTC: "Bitcoin",
  XAUT: "Tether Gold",
};
export interface WalletAddress {
  network: string;
  address: string;
  asset?: string;
  amount?: number | null;
}
export function addressesForAsset<T extends WalletAddress>(
  rows: T[],
  asset: string,
): T[] {
  return rows.filter(
    (row) => row.asset === asset && assetNetworks[asset]?.includes(row.network),
  );
}
export function isRecipientAddress(network: string, raw: string): boolean {
  const address = raw.trim();
  if (network === "TRON") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (network === "SOL") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (network === "TON")
    return /^(?:[EU]Q[A-Za-z0-9_-]{46}|(?:0|-1):[a-fA-F0-9]{64})$/.test(
      address,
    );
  if (network === "ETH" || network === "BSC")
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  return false;
}
