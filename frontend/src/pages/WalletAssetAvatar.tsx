import type { ReactNode } from "react";
import WalletNetworkIcon from "./WalletNetworkIcon";
import { assetIconStyle } from "../wallet/appearance";

/** One avatar/badge layout for portfolios and deposit/source pickers. */
export default function WalletAssetAvatar({
  icon,
  color,
  iconColor = "#fff",
  network,
}: {
  icon: ReactNode;
  color: string;
  iconColor?: string;
  network?: string;
}) {
  return (
    <span className="wpay-address-avatar">
      <span
        className="wpay-currency-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:!h-6 [&>svg]:!w-6"
        style={assetIconStyle({ color, iconColor })}
      >
        {icon}
      </span>
      {network && (
        <span className="wpay-address-network-badge">
          <WalletNetworkIcon network={network} />
        </span>
      )}
    </span>
  );
}
