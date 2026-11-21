import { useState } from "react";
import { Check, Copy } from "lucide-react";
import "./WalletAdminRecord.css";

export function RecordMenu<T extends string>({ label, tabs, active, onSelect }: {
  label: string; tabs: readonly (readonly [T, string])[]; active: T; onSelect: (id: T) => void;
}) {
  return <nav className="admin-record-menu" aria-label={label}>
    {tabs.map(([id, name]) => (
      <button key={id} type="button" aria-pressed={active === id} onClick={() => onSelect(id)}>{name}</button>
    ))}
  </nav>;
}

export function RecordValue({ label, value, copyable = false }: {
  label: string; value?: string; copyable?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const Icon = state === "copied" ? Check : Copy;
  return <div className="admin-record-field">
    <dt>{label}</dt>
    <dd>
      <span>{value || "—"}</span>
      {copyable && value && value !== "—" && (
        <button type="button" aria-label={`Скопировать ${label}`} onClick={async () => {
          try { await navigator.clipboard.writeText(value); setState("copied"); }
          catch { setState("failed"); }
        }}><Icon size={17} /></button>
      )}
    </dd>
    {state !== "idle" && <small role="status">{state === "copied" ? "Скопировано" : "Выделите значение и скопируйте вручную"}</small>}
  </div>;
}
