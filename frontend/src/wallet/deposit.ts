import { walletRequest } from "../lib/wallet-api";
import { depositNetworks, type WalletAddress } from "./catalog";
import { portfolioExamples } from "./demo";
import type { WalletAddressSelection } from "../pages/WalletAddressDetails";

/** Call only after a user chooses a network. TRON needs an amount first. */
export async function resolveDeposit(
  code: string,
  network: string,
  demo: boolean,
  signal?: AbortSignal,
): Promise<WalletAddressSelection | null> {
  if (demo) {
    const sample = portfolioExamples[network];
    return sample
      ? {
          network,
          address: sample.address,
          demo: true,
          amount: null,
          rate: null,
          min_deposit: code === "USDT" ? "1" : undefined,
        }
      : null;
  }
  if (network === "TRON" || !depositNetworks[code]?.includes(network))
    return null;
  const result =
    code === "USDT"
      ? await walletRequest<WalletAddress>("address", { network }, signal)
      : await walletRequest<WalletAddress>(
          "deposit",
          { asset: code, network },
          signal,
        );
  if (!result.address) return null;
  if (result.network !== network) throw Error("Провайдер вернул другую сеть");
  return { ...result, demo: false, amount: null, rate: null };
}
