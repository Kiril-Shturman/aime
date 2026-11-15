import type { ReactNode } from "react";
export interface Asset {
  code: string;
  name: string;
  rate: string;
  color: string;
  iconColor: string;
  icon: ReactNode;
}
export function assetIconStyle(asset: Pick<Asset, "color" | "iconColor">) {
  return {
    backgroundColor: asset.color,
    color: asset.iconColor,
    backgroundImage: `radial-gradient(ellipse at 30% 0%, rgba(255,255,255,.22), transparent 62%), linear-gradient(180deg, color-mix(in srgb, ${asset.color} 62%, white) 0%, color-mix(in srgb, ${asset.color} 90%, white) 43%, ${asset.color} 68%, color-mix(in srgb, ${asset.color} 88%, black) 100%)`,
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,.32), inset 0 -1px 2px rgba(0,0,0,.06)",
  };
}
