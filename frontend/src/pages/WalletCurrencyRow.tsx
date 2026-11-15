import { chainAmount } from "../lib/chain-amount";
import { ListItem } from "konsta/react";
import ChevronRight from "framework7-icons/react/esm/ChevronRight.js";
import { useLiveWallet, cryptoAmount, usd, usdPrice } from "./WalletLive";
import { assetIconStyle, type Asset } from "../wallet/appearance";
export function CurrencyRow({
  asset,
  deposit = false,
  balanceHidden = false,
  onClick,
}: {
  asset: Asset;
  deposit?: boolean;
  balanceHidden?: boolean;
  onClick?: () => void;
}) {
  const live = useLiveWallet();
  const rate = live.rate(asset.code);
  const rubles = asset.code === "RUB";
  return (
    <ListItem
      link={!!onClick}
      chevron={false}
      onClick={onClick}
      contentClassName="!h-[64px]"
      innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30"
      media={
        <span
          className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6"
          style={assetIconStyle(asset)}
        >
          {asset.icon}
        </span>
      }
      innerChildren={
        <span className="flex h-full w-full min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold leading-6 text-black dark:text-white">
              {asset.name}
            </span>
            <span className="mt-0.5 block truncate text-[14px] leading-5 text-black/45 dark:text-white/45">
              {asset.code}
              {!rubles && ` · ${rate !== null ? usdPrice(rate) : "—"}`}
            </span>
          </span>
          {deposit ? (
            <ChevronRight className="shrink-0 text-[19px] text-black/25 dark:text-white/30" />
          ) : (
            <span className="shrink-0 text-right">
              <span className="block text-[16px] font-medium leading-6 tabular-nums text-black dark:text-white">
                {balanceHidden
                  ? "••••"
                  : rubles
                    ? "— ₽"
                    : live.ready && live.known(asset.code)
                      ? live.custody
                        ? chainAmount(live.balance(asset.code))
                        : cryptoAmount(live.balance(asset.code))
                      : "—"}
              </span>
              {!rubles && (
                <span className="block text-[12px] leading-5 tabular-nums text-black/40 dark:text-white/40">
                  {balanceHidden
                    ? "••••"
                    : live.ready && live.known(asset.code) && rate !== null
                      ? usd(Number(live.balance(asset.code)) * rate)
                      : "—"}
                </span>
              )}
            </span>
          )}
        </span>
      }
    />
  );
}

export function CurrencySkeletonRow({
  rubles = false,
  deposit = false,
}: {
  rubles?: boolean;
  deposit?: boolean;
}) {
  const block =
    "animate-pulse motion-reduce:animate-none rounded-full bg-black/[.07] dark:bg-white/[.09]";
  return (
    <ListItem
      chevron={false}
      contentClassName="!h-[64px]"
      innerClassName="!min-w-0 !h-[64px] !py-2 after:!opacity-30"
      media={<span className={`block h-11 w-11 shrink-0 ${block}`} />}
      innerChildren={
        <span
          className="flex h-full w-full min-w-0 items-center justify-between gap-3"
          aria-hidden="true"
        >
          <span className="min-w-0">
            <span className={`block h-3.5 w-24 max-w-full ${block}`} />
            <span className={`mt-2 block h-3 w-16 max-w-full ${block}`} />
          </span>
          <span className="shrink-0">
            {deposit ? (
              <span className={`block h-4 w-2 ${block}`} />
            ) : (
              <>
                <span className={`ml-auto block h-3.5 w-14 ${block}`} />
                {!rubles && (
                  <span className={`ml-auto mt-2 block h-3 w-11 ${block}`} />
                )}
              </>
            )}
          </span>
        </span>
      }
    />
  );
}
