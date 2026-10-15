"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CompanyBrand, MobileNavigation } from "../../navigation";
import { localizedUiError, LanguageSwitcher, apiRequestError, useLocale } from "../../i18n";
import { Icon } from "../../visuals";
import { ReportPrintButton, ReportPrintMeta } from "../../report-export";

const API = "";
type Partner = { id: string; name: string; balance: number };
type Account = { code: string; kind: string; label: string; controlBalance: number; subledgerBalance: number; difference: number; balanced: boolean; partners: Partner[]; unallocatedLineCount: number; unallocatedLines: Array<{ id: string; entryNumber: string; date: string; description: string; detail: string; amount: number }> };
type Result = { asOf: string; branchId: string | null; accounts: Account[] };
const words = {
  en: { title: "Control account check", intro: "Compare customer, supplier, broker and employee balances with their general-ledger control accounts.", asOf: "Balance as of", apply: "Check balances", control: "Control account", subledger: "Partner ledgers", difference: "Unallocated difference", balanced: "Matched", mismatch: "Needs review", details: "Partner balances", empty: "No tagged ledger entries", unallocatedEntries: "Unallocated journal entries", showingLimit: "Showing the latest 500 entries.", date: "Date", entry: "Journal entry", scope: "This report follows your active branch and includes shared entries.", error: "Could not load the reconciliation.", loading: "Checking ledger balances…", home: "Overview", reports: "Reports", amount: "Balance", explain: "A difference can mean a journal was posted without selecting a customer, supplier, broker or employee. Review the source entries before making an adjustment." },
  ta: { title: "கட்டுப்பாட்டுக் கணக்கு ஒப்பீடு", intro: "வாடிக்கையாளர், வழங்குநர், தரகர், பணியாளர் இருப்புகளைப் பொதுப் பேரேட்டுக் கணக்குடன் ஒப்பிடுங்கள்.", asOf: "இந்த தேதியிலான இருப்பு", apply: "இருப்புகளைச் சரிபார்", control: "கட்டுப்பாட்டுக் கணக்கு", subledger: "தனிப்பட்ட பேரேடுகள்", difference: "ஒதுக்கப்படாத வேறுபாடு", balanced: "பொருந்துகிறது", mismatch: "சரிபார்க்க வேண்டும்", details: "தனிப்பட்ட இருப்புகள்", empty: "இணைக்கப்பட்ட பேரேடு பதிவுகள் இல்லை", unallocatedEntries: "ஒதுக்கப்படாத கணக்குப் பதிவுகள்", showingLimit: "சமீபத்திய 500 பதிவுகள் காட்டப்படுகின்றன.", date: "தேதி", entry: "கணக்குப் பதிவு", scope: "இந்த அறிக்கை செயலில் உள்ள கிளையையும் பகிரப்பட்ட பதிவுகளையும் பயன்படுத்தும்.", error: "பேரேடு ஒப்பீட்டை ஏற்ற முடியவில்லை.", loading: "பேரேடு இருப்புகள் சரிபார்க்கப்படுகின்றன…", home: "கண்ணோட்டம்", reports: "அறிக்கைகள்", amount: "இருப்பு", explain: "ஒரு வேறுபாடு, வாடிக்கையாளர், வழங்குநர், தரகர் அல்லது பணியாளரைத் தேர்ந்தெடுக்காமல் கணக்குப் பதிவு செய்யப்பட்டதைக் குறிக்கலாம். மாற்றுப் பதிவு செய்வதற்கு முன் மூலப் பதிவுகளைச் சரிபார்க்கவும்." },
} as const;

function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }

export default function SubledgerReconciliationPage() {
  const { locale } = useLocale();
  const w = words[locale];
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const money = useCallback((value: number) => new Intl.NumberFormat(locale === "ta" ? "ta-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value), [locale]);
  const load = useCallback(async (date = asOf) => {
    setLoading(true); setError("");
    try {
      const token = sessionStorage.getItem("brick-erp-session");
      if (!token) { window.location.replace("/"); return; }
      const query = new URLSearchParams({ asOf: date });
      const response = await fetch(`${API}/api/accounting/subledger-reconciliation?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) { window.location.replace("/"); return; }
      if (!response.ok) throw apiRequestError(body, w.error, response.status);
      setData(body as Result);
    } catch (cause) { setError(localizedUiError(cause, locale, w.error)); }
    finally { setLoading(false); }
  }, [asOf, w.error]);
  useEffect(() => { void load(today()); }, [load]);
  function submit(event: FormEvent) { event.preventDefault(); void load(asOf); }
  const matched = data?.accounts.every(account => account.balanced) ?? false;

  return <main className="dashboard-shell">
    <aside className="sidebar"><CompanyBrand href="/dashboard"/><div className="nav-label">{w.home.toUpperCase()}</div><a className="nav-item" href="/dashboard"><Icon name="home" size={17}/>{w.home}</a><a className="nav-item active" href="/reports"><Icon name="chart" size={17}/>{w.reports}</a></aside>
    <MobileNavigation active="reports"/><section className="dashboard-main"><header className="topbar"><div className="breadcrumb"><a href="/dashboard">{w.home}</a><span>/</span><a href="/reports">{w.reports}</a><span>/</span>{w.title}</div><div className="topbar-right"><LanguageSwitcher/></div></header>
      <div className="dashboard-content master-content"><div className="master-heading"><div><div className="eyebrow muted">BRICK CHAMBER ERP</div><h1>{w.title}</h1><p>{w.intro}</p></div><div className="report-actions"><ReportPrintButton label={locale === "ta" ? "அச்சிடு / PDF ஆகச் சேமி" : "Print / save PDF"}/></div></div>
        <ReportPrintMeta>{w.title} · {w.asOf}: {data?.asOf ?? asOf}</ReportPrintMeta>
        <div className="sales-note"><Icon name="shield" size={16}/>{w.scope}</div>
        <form className="report-filter" onSubmit={submit}><label>{w.asOf}<input type="date" max={today()} value={asOf} onChange={event => setAsOf(event.target.value)}/></label><button className="master-add" disabled={loading}><Icon name="search" size={17}/>{w.apply}</button></form>
        {error && <div className="master-alert error" role="alert"><Icon name="alert" size={17}/>{error}</div>}
        {loading ? <div className="master-empty">{w.loading}</div> : data && <>
          <div className={`sales-note ${matched ? "" : "master-alert error"}`} role="status"><Icon name={matched ? "check" : "alert"} size={17}/>{matched ? w.balanced : w.mismatch} · {data.accounts.filter(account => account.balanced).length}/{data.accounts.length}</div>
          {!matched && <div className="sales-note"><Icon name="shield" size={16}/>{w.explain}</div>}
          <div className="master-form-grid">{data.accounts.map(account => <section className="master-form" key={account.code}>
            <div className="master-form-heading"><div><b>{locale === "ta" ? ({customer:"வாடிக்கையாளர் பெறவேண்டியது",supplier:"வழங்குநர் செலுத்தவேண்டியது",broker:"தரகர் செலுத்தவேண்டியது",employee:"பணியாளர் முன்பணம்"} as Record<string,string>)[account.kind] : account.label}</b><p>{account.code} · {account.balanced ? w.balanced : w.mismatch}</p></div><Icon name={account.kind === "customer" ? "users" : account.kind === "employee" ? "user" : "calculator"} size={21}/></div>
            <div className="master-table-wrap"><table className="master-table"><tbody><tr><th>{w.control}</th><td>{money(account.controlBalance)}</td></tr><tr><th>{w.subledger}</th><td>{money(account.subledgerBalance)}</td></tr><tr><th>{w.difference}</th><td><b>{money(account.difference)}</b></td></tr></tbody></table></div>
            <details className="reconciliation-details"><summary>{w.details} · {account.partners.length}</summary>{account.partners.length ? <div className="master-table-wrap"><table className="master-table"><thead><tr><th>{locale === "ta" ? "பெயர்" : "Name"}</th><th>{w.amount}</th></tr></thead><tbody>{account.partners.map(partner => <tr key={partner.id}><td>{partner.name}</td><td>{money(partner.balance)}</td></tr>)}</tbody></table></div> : <div className="master-empty">{w.empty}</div>}</details>
            {account.unallocatedLineCount > 0 && <details className="reconciliation-details"><summary>{w.unallocatedEntries} · {account.unallocatedLineCount}</summary>{account.unallocatedLineCount > 500 && <div className="sales-note">{w.showingLimit}</div>}<div className="master-table-wrap"><table className="master-table"><thead><tr><th>{w.date}</th><th>{w.entry}</th><th>{locale === "ta" ? "விவரம்" : "Description"}</th><th>{w.amount}</th></tr></thead><tbody>{account.unallocatedLines.map(line => <tr key={line.id}><td>{line.date}</td><td><b>{line.entryNumber}</b></td><td>{line.detail || line.description}</td><td>{money(line.amount)}</td></tr>)}</tbody></table></div></details>}
          </section>)}</div>
        </>}
      </div><footer className="dash-footer">Brick Chamber ERP <span>·</span> {w.title}</footer>
    </section>
  </main>;
}
