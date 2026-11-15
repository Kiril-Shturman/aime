/** Explicit preview fixtures; never use as a fallback for failed live requests. */
export const previewBalances: Record<string, { amount: number; rate: number }> =
  {
    USDT: { amount: 1234.56, rate: 1 },
    TRX: { amount: 12450.543, rate: 0.3166 },
    GRAM: { amount: 1250.45, rate: 1.25 },
    BTC: { amount: 0.024543, rate: 73025 },
    XAUT: { amount: 0.543, rate: 3942 },
    ETH: { amount: 0.75, rate: 2026 },
    BNB: { amount: 2.45, rate: 663.02 },
    SOL: { amount: 12.5, rate: 82.63 },
  };
export const portfolioExamples: Record<
  string,
  { address: string; amount: number }
> = {
  BSC: { address: "0x8e908DEMO0a268", amount: 425.5 },
  ETH: { address: "0x47a2fDEMO9c1d3", amount: 310.06 },
  TON: { address: "UQBs7f2DEMOk9W3x", amount: 180 },
  SOL: { address: "7Kp3x9qDEMO2mN8a", amount: 219 },
  TRON: { address: "TQ8e908DEMO0a268", amount: 100 },
  BTC: { address: "bc1q8e9DEMO0a268", amount: 0.024543 },
};
