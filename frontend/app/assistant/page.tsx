"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiRequestError, localizedUiError, LanguageSwitcher, useLocale } from "../i18n";
import { CompanyBrand, MobileNavigation } from "../navigation";
import { Icon } from "../visuals";

const API = "";
type ReminderDraft = { id: string; customerId: string; customerName: string; outstandingAmount: string; language: "en" | "ta"; message: string; status: "draft" | "archived"; createdAt: string };
type ReminderCandidate = { customerId: string; customer: string; outstanding: string };
type Message = { question: string; answer?: string; sources?: string[]; scope?: "selected_branch" | "all_branches"; draftCandidates?: ReminderCandidate[]; savedDrafts?: ReminderDraft[]; error?: string };

export default function AssistantPage() {
  const { locale } = useLocale();
  const ta = locale === "ta";
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [drafts, setDrafts] = useState<ReminderDraft[]>([]);
  const [creatingDraftFor, setCreatingDraftFor] = useState("");
  const [draftError, setDraftError] = useState("");
  const [setupError, setSetupError] = useState("");
  const words = ta ? {
    title: "உரிமையாளர் வணிக உதவியாளர்", intro: "அங்கீகரிக்கப்பட்ட ERP பதிவுகளிலிருந்து வணிகத் தகவலைக் கேளுங்கள்.",
    notice: "உங்கள் கேள்வியும் தொடர்புடைய ERP சுருக்கத் தரவும் அமைக்கப்பட்ட AI வழங்குநருக்கு அனுப்பப்படும். சரிபார்க்கப்பட்ட நிலுவைத் தொகைக்கு அனுப்பப்படாத நினைவூட்டல் வரைவைக் காப்பாற்றலாம்; அதைப் பரிசீலித்து நீங்களே அனுப்ப வேண்டும்.",
    config: "உதவியாளர் இன்னும் அமைக்கப்படவில்லை. backend/.env கோப்பில் OPENAI_API_KEY மற்றும் OPENAI_MODEL அமைத்து API-ஐ மறுதொடக்கம் செய்யுங்கள்.",
    prompt: "உங்கள் வணிகத்தைப் பற்றி கேளுங்கள்…", ask: "கேளுங்கள்", asking: "தகவலைப் பார்க்கிறது…", sources: "பார்த்த ERP பதிவுகள்",
    suggestions: ["இன்றைய வணிக நிலை என்ன?", "₹1 லட்சத்துக்கு மேல் நிலுவை வைத்துள்ள வாடிக்கையாளர்களைக் காட்டு", "நிலுவையில் உள்ள தரகர் கமிஷன் எவ்வளவு?", "இன்றைய ஏற்றுதல் அளவு வேறுபாடுகளைக் காட்டு"],
    home: "கண்ணோட்டம்", assistant: "உரிமையாளர் உதவியாளர்", unavailable: "கேள்விக்கு பதிலளிக்க முடியவில்லை.", scopeAll: "அனைத்து கிளைகள்", scopeBranch: "தேர்ந்தெடுத்த கிளை + பொதுப் பதிவுகள்", makeDraft: "நினைவூட்டல் வரைவைச் சேமி", savingDraft: "வரைவு சேமிக்கப்படுகிறது…", savedDraft: "சேமிக்கப்பட்ட அனுப்பப்படாத வரைவு", draftTitle: "சேமித்த நினைவூட்டல் வரைவுகள்", noDrafts: "இன்னும் வரைவுகள் இல்லை.", draftOnly: "வரைவு மட்டும் · அனுப்பப்படவில்லை",
  } : {
    title: "Owner business assistant", intro: "Ask about business activity using approved ERP records.",
    notice: "Your question and relevant ERP summary data are sent to the configured AI provider. You can save an unsent reminder draft for a verified receivable; review and send it yourself.",
    config: "The assistant is not configured yet. Set OPENAI_API_KEY and OPENAI_MODEL in backend/.env, then restart the API.",
    prompt: "Ask about your business…", ask: "Ask", asking: "Checking records…", sources: "ERP records checked",
    suggestions: ["How is business today?", "Show customers owing more than ₹1 lakh", "How much broker commission is pending?", "Show today's loading mismatches"],
    home: "Overview", assistant: "Owner assistant", unavailable: "Could not answer that question.", scopeAll: "All branches", scopeBranch: "Selected branch + shared records", makeDraft: "Save reminder draft", savingDraft: "Saving draft…", savedDraft: "Saved unsent draft", draftTitle: "Saved reminder drafts", noDrafts: "No drafts yet.", draftOnly: "Draft only · not sent",
  };
  const sourceLabel = (code: string) => ({ business_today: ta ? "இன்றைய செயல்பாடுகள்" : "Today's operations", customer_outstanding: ta ? "வாடிக்கையாளர் நிலுவை" : "Customer receivables", broker_commission_pending: ta ? "தரகர் கமிஷன்" : "Broker commission", employee_advance_outstanding: ta ? "பணியாளர் முன்பணம்" : "Employee advances", loading_mismatches_today: ta ? "ஏற்றுதல் வேறுபாடுகள்" : "Loading mismatches" } as Record<string, string>)[code] ?? code;

  useEffect(() => {
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token) { window.location.replace("/"); return; }
    let live = true;
    void fetch(`${API}/api/ai/status`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async response => {
        if (response.status === 401) { window.location.replace("/"); return null; }
        if (response.status === 403) { window.location.replace("/dashboard"); return null; }
        if (!response.ok) throw new Error(words.unavailable);
        return response.json();
      })
      .then(data => { if (live && data) { setConfigured(data.configured === true); setReady(true); void fetch(`${API}/api/ai/reminder-drafts`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(r => r.ok ? r.json() : null).then(result => { if (live && Array.isArray(result?.drafts)) setDrafts(result.drafts); }).catch(() => undefined); } })
      .catch(error => { if (live) { setSetupError(localizedUiError(error, locale, words.unavailable)); setReady(true); } });
    return () => { live = false; };
  }, [words.unavailable]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token || !question.trim() || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${API}/api/ai/ask`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ question: question.trim() }) });
      const data = await response.json();
      if (!response.ok) throw apiRequestError(data, words.unavailable);
      setMessage({ question: question.trim(), answer: data.answer, sources: data.sources ?? [], scope: data.scope, draftCandidates: data.draftCandidates ?? [] });
      setQuestion("");
    } catch (error) { setMessage({ question: question.trim(), error: localizedUiError(error, locale, words.unavailable) }); }
    finally { setBusy(false); }
  }

  async function saveReminderDraft(candidate: ReminderCandidate) {
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token || creatingDraftFor) return;
    setCreatingDraftFor(candidate.customerId); setDraftError("");
    try {
      const response = await fetch(`${API}/api/ai/reminder-drafts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: candidate.customerId, language: ta ? "ta" : "en" }) });
      const data = await response.json();
      if (!response.ok) throw apiRequestError(data, words.unavailable);
      const draft = data.draft as ReminderDraft;
      setDrafts(current => [draft, ...current.filter(item => item.id !== draft.id)].slice(0, 30));
      setMessage(current => current ? { ...current, savedDrafts: [...(current.savedDrafts ?? []), draft] } : current);
    } catch (error) { setDraftError(localizedUiError(error, locale, words.unavailable)); }
    finally { setCreatingDraftFor(""); }
  }

  const formatMoney = (value: string | number) => new Intl.NumberFormat(ta ? "ta-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
  return <main className="dashboard-shell">
    <aside className="sidebar"><CompanyBrand href="/dashboard"/><nav className="sidebar-navigation"><div className="nav-label">{ta ? "பணியிடம்" : "WORKSPACE"}</div><a className="nav-item" href="/dashboard"><Icon name="home" size={17}/>{words.home}</a><a className="nav-item active" href="/assistant"><Icon name="chart" size={17}/>{words.assistant}</a></nav></aside>
    <MobileNavigation active={null}/>
    <section className="dashboard-main"><header className="topbar"><div className="breadcrumb"><a href="/dashboard">{words.home}</a><span>/</span>{words.assistant}</div><div className="topbar-right"><LanguageSwitcher/></div></header>
      <div className="dashboard-content assistant-content">
        <div className="assistant-heading"><div className="assistant-mark"><Icon name="chart" size={22}/></div><div><div className="eyebrow muted">BRICK CHAMBER ERP</div><h1>{words.title}</h1><p>{words.intro}</p></div></div>
        <div className="assistant-privacy"><Icon name="shield" size={18}/><span>{words.notice}</span></div>
        {!ready ? <div className="assistant-card" aria-live="polite">{ta ? "உதவியாளரை ஏற்றுகிறது…" : "Loading assistant…"}</div> : setupError ? <div className="master-alert error">{setupError}</div> : !configured ? <div className="assistant-config"><Icon name="settings" size={20}/><div><b>{ta ? "அமைப்பு தேவை" : "Setup required"}</b><p>{words.config}</p></div></div> : <>
          <div className="assistant-suggestions"><b>{ta ? "இதில் ஒன்றைக் கேளுங்கள்" : "Try asking"}</b><div>{words.suggestions.map(item => <button type="button" key={item} onClick={() => setQuestion(item)}>{item}</button>)}</div></div>
          <section className="assistant-card" aria-live="polite">
            {message ? <div className="assistant-response">
              <div className="assistant-question"><span>{ta ? "நீங்கள் கேட்டது" : "You asked"}</span><b>{message.question}</b></div>
              {message.error ? <div className="master-alert error">{message.error}</div> : <>
                <div className="assistant-answer">{message.answer}</div>
                <div className="assistant-sources"><span>{ta ? "தரவு வரம்பு" : "Data scope"}:</span><span className="assistant-source">{message.scope === "all_branches" ? words.scopeAll : words.scopeBranch}</span>{Boolean(message.sources?.length) && <><span>{words.sources}:</span>{message.sources!.map(code => <span className="assistant-source" key={code}>{sourceLabel(code)}</span>)}</>}</div>
                {Boolean(message.draftCandidates?.length) && <section className="assistant-draft-candidates"><b>{ta ? "நிலுவை உள்ள வாடிக்கையாளர்களுக்கான வரைவு" : "Payment reminder drafts for these customers"}</b>{message.draftCandidates!.map(candidate => {
                  const saved = message.savedDrafts?.find(draft => draft.customerId === candidate.customerId);
                  return <div className="assistant-draft-candidate" key={candidate.customerId}><div><b>{candidate.customer}</b><span>{formatMoney(candidate.outstanding)}</span></div>{saved ? <div className="assistant-draft-message"><small>{words.draftOnly}</small><p>{saved.message}</p></div> : <button type="button" disabled={Boolean(creatingDraftFor)} onClick={() => void saveReminderDraft(candidate)}>{creatingDraftFor === candidate.customerId ? words.savingDraft : words.makeDraft}</button>}</div>;
                })}</section>}
              </>}
            </div> : <div className="assistant-empty"><Icon name="chart" size={27}/><span>{ta ? "தொடங்க மேலே உள்ள கேள்வியைத் தேர்ந்தெடுக்கவும் அல்லது உங்கள் சொந்த கேள்வியை எழுதவும்." : "Choose a suggested question or write your own to get started."}</span></div>}
          </section>
          {draftError && <div className="master-alert error">{draftError}</div>}
          <form className="assistant-form" onSubmit={ask}><textarea aria-label={words.prompt} placeholder={words.prompt} maxLength={1200} rows={3} value={question} onChange={event => setQuestion(event.target.value)}/><div className="assistant-form-footer"><small>{question.length}/1200</small><button type="submit" className="primary-button" disabled={busy || question.trim().length < 3}><Icon name="arrowRight" size={16}/>{busy ? words.asking : words.ask}</button></div></form>
        </>}
        {ready && !setupError && <section className="assistant-draft-history"><h2>{words.draftTitle}</h2>{drafts.length ? drafts.map(draft => <article className="assistant-draft-history-item" key={draft.id}><div><b>{draft.customerName}</b><span>{formatMoney(draft.outstandingAmount)} · {words.draftOnly}</span></div><p>{draft.message}</p><small>{new Date(draft.createdAt).toLocaleString(ta ? "ta-IN" : "en-IN")}</small></article>) : <p>{words.noDrafts}</p>}</section>}
      </div>
    </section>
  </main>;
}
