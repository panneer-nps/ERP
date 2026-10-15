"use client";

import { useEffect, useState } from "react";

const API = "";
type Code = "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";
type Mode = { code: Code; active: boolean; accountAvailable: boolean | null };
const labels: Record<"en" | "ta", Record<Code, string>> = {
  en: { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", card: "Card", other: "Other" },
  ta: { cash: "ரொக்கம்", upi: "UPI", bank_transfer: "வங்கி பரிமாற்றம்", cheque: "காசோலை", card: "அட்டை", other: "மற்றவை" },
};

export function PaymentModeSelect({ locale, defaultValue = "cash" }: { locale: "en" | "ta"; defaultValue?: Code }) {
  const [modes, setModes] = useState<Mode[]>([]);
  const [value, setValue] = useState<Code>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token) { setFailed(true); setLoading(false); return; }
    let live = true;
    void fetch(`${API}/api/payment-modes`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("payment mode request failed");
        const data = await response.json();
        if (!live) return;
        const available = (data.modes ?? []).filter((mode: Mode) => mode.active && mode.accountAvailable !== false);
        setModes(available);
        if (available.length && !available.some((mode: Mode) => mode.code === defaultValue)) setValue(available[0].code);
      })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [defaultValue]);

  return <select name="paymentMethod" value={value} onChange={(event) => setValue(event.target.value as Code)} required disabled={loading || failed || modes.length === 0}>
    {loading && <option value="">{locale === "ta" ? "ஏற்றப்படுகிறது…" : "Loading payment methods…"}</option>}
    {!loading && failed && <option value="">{locale === "ta" ? "பணம் செலுத்தும் முறைகளை ஏற்ற முடியவில்லை" : "Payment methods unavailable"}</option>}
    {!loading && !failed && modes.length === 0 && <option value="">{locale === "ta" ? "செயலில் உள்ள முறை இல்லை" : "No active payment method"}</option>}
    {modes.map((mode) => <option key={mode.code} value={mode.code}>{labels[locale][mode.code]}</option>)}
  </select>;
}
