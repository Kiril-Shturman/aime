import { walletRequest } from "./wallet-api";
/** Read-only contract from wpay/aura-provider-foundation at 2e28de8. */
export type AuraCard = {
  card_id: string;
  kind: "virtual" | "physical";
  status: string;
  frozen: boolean;
  masked_pan: string | null;
  delivery_status: string | null;
  provider_updated_at: number | string | null;
};
export async function getOwnCards(signal: AbortSignal): Promise<AuraCard[]> {
  const result = await walletRequest<{ data: unknown[] }>(
    "aura-cards",
    undefined,
    signal,
  );
  if (!Array.isArray(result.data))
    throw Error("Не удалось прочитать список карт");
  return result.data.map((row) => {
    if (!row || typeof row !== "object")
      throw Error("Некорректные данные карты");
    const card = row as Record<string, unknown>;
    if (
      typeof card.card_id !== "string" ||
      !card.card_id ||
      !["virtual", "physical"].includes(String(card.kind)) ||
      typeof card.status !== "string" ||
      typeof card.frozen !== "boolean"
    )
      throw Error("Некорректные данные карты");
    return {
      card_id: card.card_id,
      kind: card.kind as AuraCard["kind"],
      status: card.status,
      frozen: card.frozen,
      masked_pan:
        typeof card.masked_pan === "string" &&
        card.masked_pan.replace(/\D/g, "").length >= 4
          ? "•••• " + card.masked_pan.replace(/\D/g, "").slice(-4)
          : null,
      delivery_status:
        typeof card.delivery_status === "string" ? card.delivery_status : null,
      provider_updated_at:
        typeof card.provider_updated_at === "number" ||
        typeof card.provider_updated_at === "string"
          ? card.provider_updated_at
          : null,
    };
  });
}
