/** Format atomic-derived decimal balances without converting them through Number. */
export function chainAmount(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (decimals ? "." + decimals : "");
}
