"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkspaceSidebar, MobileNavigation } from "../../navigation";
import { LanguageSwitcher, useLocale } from "../../i18n";
import { Icon } from "../../visuals";

const API = "";
type ModeCode = "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";
type Mode = { code: ModeCode; accountCode: string; active: boolean; accountAvailable: boolean | null };
type Account = { code: string; name: string; accountType: string; active: boolean };

const names = {
  en: { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", card: "Card", other: "Other" },
  ta: { cash: "ரொக்கம்", upi: "UPI", bank_transfer: "வங்கி பரிமாற்றம்", cheque: "காசோலை", card: "அட்டை", other: "மற்றவை" },
};
const words = {
  en: { title: "Payment methods", intro: "Choose the payment methods your company accepts. Cash posts to Cash on hand (1110); non-cash methods post to Bank and UPI (1120) so cash closing and bank reports stay consistent.", loading: "Loading payment settings…", enabled: "Enabled", disabled: "Disabled", account: "Settlement account", save: "Save method", saving: "Saving…", saved: "Payment method settings saved.", error: "Could not load or save payment settings.", ownerOnly: "Only the company Owner can change these settings.", noAccounts: "No active asset accounts are available. Set up a cash or bank account first.", audit: "Changes are recorded in the audit history.", methods: "Available methods", noMode: "At least one payment method must stay enabled.", home: "Overview", users: "User access", company: "Company profile", paymentModes: "Payment methods", roles: "Roles and permissions", sequences: "Document numbers" },
  ta: { title: "பணம் செலுத்தும் முறைகள்", intro: "நிறுவனம் ஏற்கும் செலுத்தும் முறைகளைத் தேர்வு செய்யவும். ரொக்கம் Cash on hand (1110) கணக்கிலும், மற்ற முறைகள் Bank and UPI (1120) கணக்கிலும் பதிவாகும்; இதனால் பண முடிப்பு மற்றும் வங்கி அறிக்கைகள் சீராக இருக்கும்.", loading: "பணம் செலுத்தும் அமைப்புகள் ஏற்றப்படுகின்றன…", enabled: "செயலில்", disabled: "செயலற்றது", account: "பரிவர்த்தனை கணக்கு", save: "முறையைச் சேமி", saving: "சேமிக்கப்படுகிறது…", saved: "பணம் செலுத்தும் முறை அமைப்புகள் சேமிக்கப்பட்டன.", error: "பணம் செலுத்தும் அமைப்புகளை ஏற்றவோ சேமிக்கவோ முடியவில்லை.", ownerOnly: "நிறுவன உரிமையாளர் மட்டுமே இந்த அமைப்புகளை மாற்ற முடியும்.", noAccounts: "செயலில் உள்ள சொத்துக் கணக்குகள் இல்லை. முதலில் ரொக்கம் அல்லது வங்கிக் கணக்கை அமைக்கவும்.", audit: "மாற்றங்கள் தணிக்கை வரலாற்றில் பதிவு செய்யப்படும்.", methods: "கிடைக்கும் முறைகள்", noMode: "குறைந்தது ஒரு பணம் செலுத்தும் முறையாவது செயலில் இருக்க வேண்டும்.", home: "கண்ணோட்டம்", users: "பயனர் அணுகல்", company: "நிறுவன விவரம்", paymentModes: "பணம் செலுத்தும் முறைகள்", roles: "பங்குகள் மற்றும் அனுமதிகள்", sequences: "ஆவண எண்கள்" },
};

export default function PaymentModesPage() {
  const { locale } = useLocale();
  const w = words[locale];
  const [token, setToken] = useState("");
  const [modes, setModes] = useState<Mode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ModeCode | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const accountOptions = useMemo(() => accounts.filter((account) => account.active && account.accountType === "asset"), [accounts]);

  useEffect(() => {
    const savedToken = sessionStorage.getItem("brick-erp-session") ?? "";
    setToken(savedToken);
    if (!savedToken) { setLoading(false); setError(w.ownerOnly); return; }
    let live = true;
    const headers = { Authorization: `Bearer ${savedToken}` };
    void Promise.all([
      fetch(`${API}/api/payment-modes`, { headers, cache: "no-store" }),
      fetch(`${API}/api/accounting/accounts`, { headers, cache: "no-store" }),
    ]).then(async ([modeResponse, accountResponse]) => {
      const [modeData, accountData] = await Promise.all([modeResponse.json(), accountResponse.json()]);
      if (!live) return;
      if (modeResponse.status === 403) { setError(w.ownerOnly); return; }
      if (!modeResponse.ok || !accountResponse.ok) { setError(w.error); return; }
      setModes(modeData.modes ?? []);
      setAccounts(accountData.accounts ?? []);
    }).catch(() => { if (live) setError(w.error); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [w.error, w.ownerOnly]);

  function updateMode(code: ModeCode, change: Partial<Mode>) {
    setModes((current) => current.map((mode) => mode.code === code ? { ...mode, ...change } : mode));
    setError(""); setNotice("");
  }

  async function saveMode(mode: Mode) {
    if (!token || saving) return;
    if (!mode.active && modes.filter((item) => item.active).length === 1) { setError(w.noMode); return; }
    setSaving(mode.code); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/payment-modes/${mode.code}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ active: mode.active, accountCode: mode.accountCode }) });
      if (!response.ok) { const data = await response.json().catch(() => null); setError(data?.error?.code === "PAYMENT_MODE_REQUIRED" ? w.noMode : data?.error?.message ?? w.error); return; }
      const data = await response.json();
      setModes((current) => current.map((item) => item.code === mode.code ? { ...item, active: data.active, accountCode: data.accountCode, accountAvailable: true } : item));
      setNotice(w.saved);
    } catch { setError(w.error); } finally { setSaving(""); }
  }

  return <main className="dashboard-shell"><WorkspaceSidebar/><section className="dashboard-main"><MobileNavigation active={null}/><header className="dash-top"><div><span className="eyebrow">{locale === "ta" ? "நிறுவன நிர்வாகம்" : "COMPANY ADMINISTRATION"}</span><h1>{w.title}</h1></div><LanguageSwitcher/></header><div className="payment-mode-content"><p className="payment-mode-intro">{w.intro}</p>{loading ? <div className="master-empty">{w.loading}</div> : <><section className="payment-mode-grid" aria-label={w.methods}>{modes.map((mode) => <article className="payment-mode-card" key={mode.code}><div className="payment-mode-card-heading"><span className="payment-mode-icon"><Icon name={mode.code === "cash" ? "cash" : mode.code === "bank_transfer" ? "building" : "receipt"} size={20}/></span><div><h2>{names[locale][mode.code]}</h2><code>{mode.code}</code></div><label className="payment-mode-switch"><input type="checkbox" checked={mode.active} onChange={(event) => updateMode(mode.code, { active: event.target.checked })}/><span>{mode.active ? w.enabled : w.disabled}</span></label></div><label className="payment-mode-account">{w.account}<div className="payment-mode-ledger">{mode.accountCode} · {accountOptions.find((account) => account.code === mode.accountCode)?.name ?? (locale === "ta" ? "கிடைக்கவில்லை" : "unavailable")}</div></label><button className="master-save payment-mode-save" disabled={saving !== "" || !accountOptions.some((account) => account.code === (mode.code === "cash" ? "1110" : "1120"))} onClick={() => void saveMode(mode)}>{saving === mode.code ? w.saving : w.save}</button></article>)}</section>{accountOptions.length === 0 && <p className="payment-mode-error">{w.noAccounts}</p>}<p className="payment-mode-audit"><Icon name="shield" size={16}/>{w.audit}</p></>}{error && <p role="alert" className="payment-mode-error">{error}</p>}{notice && <p role="status" className="payment-mode-notice">{notice}</p>}</div></section></main>;
}
