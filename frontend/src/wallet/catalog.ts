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
  provider?: string;
  provider_available?: string;
  chain?: string;
  network: string;
  address: string;
  asset?: string;
  assets?: string[];
  min_deposit?: string;
  amount?: number | null;
}
export function addressesForAsset<T extends WalletAddress>(
  rows: T[],
  asset: string,
): T[] {
  return rows.filter(
    (row) =>
      (row.assets?.includes(asset) || row.asset === asset) &&
      assetNetworks[asset]?.includes(row.network),
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

/** Holdings and admin visibility do not imply a provider can receive this asset. */
export function availableDepositRoutes(status: {
  asset_routes?: Record<string, string[]>;
  deposit_providers?: Record<string, Record<string, string>>;
  deposit_modes?: Record<
    string,
    Record<string, "address" | "exact" | "disabled">
  >;
  providers?: { goswap?: { configured?: boolean } };
  capabilities?: { crypto_processing?: boolean };
}): Record<string, string[]> {
  const legacy =
    !status.providers || status.providers.goswap?.configured === true;
  const result: Record<string, string[]> = {};
  for (const [asset, networks] of Object.entries(status.asset_routes ?? {})) {
    const active = networks.filter((network) => {
      const mode = status.deposit_modes?.[asset]?.[network];
      if (status.deposit_providers) return mode === "address" || mode === "exact";
      if (mode === "disabled") return false;
      if (
        mode === "address" &&
        status.capabilities?.crypto_processing !== false
      )
        return true;
      return legacy && (depositNetworks[asset] ?? []).includes(network);
    });
    if (active.length) result[asset] = active;
  }
  return result;
}
