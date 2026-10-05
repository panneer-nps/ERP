"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { LanguageSwitcher, useLocale } from "../i18n";
import { BrickChamberIllustration, Icon } from "../visuals";
import type { TranslationKey } from "../i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Setup() {
  const { t } = useLocale();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/setup-status`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("setupUnavailable"));
        const data = await response.json();
        setSetupRequired(data.setupRequired === true);
      })
      .catch(() => setError("setupUnavailable"));
  }, [t]);

  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) { setError("passwordMismatch"); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, ownerName, email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.code === "SETUP_COMPLETE" ? "setupAlreadyComplete" : "setupFailed");
        return;
      }
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch {
      setError("serverCouldNotBeReached");
    } finally { setBusy(false); }
  }

  return (
    <main className="login-shell">
      <section className="brand-panel">
        <BrickChamberIllustration />
        <div className="brand-mark">BC</div>
        <div className="eyebrow">{t("brand")}</div>
        <h1>{t("setupHeadline")}</h1>
        <p>{t("setupCopy")}</p>
        <div className="brand-footer">{t("setupFooter")}</div>
      </section>
      <section className="form-panel">
        <div className="language-switcher-floating"><LanguageSwitcher /></div>
        <div className="login-form">
          <div className="eyebrow muted">{t("firstSetup")}</div>
          <h2>{complete ? t("workspaceCreated") : t("createOwnerTitle")}</h2>
          <p className="subcopy">{complete ? t("ownerAccountReady") : t("setupExplanation")}</p>
          {complete ? <Link className="primary-link" href="/">{t("goToSignIn")} <Icon name="arrowRight" size={18} /></Link> : setupRequired === false ? <div className="setup-closed" role="status"><Icon name="shield" size={18} />{t("setupAlreadyComplete")}</div> : (
            <form onSubmit={createOwner}>
              <label className="field-label" htmlFor="company"><Icon name="building" size={15} />{t("companyName")}</label>
              <input id="company" autoComplete="organization" required minLength={2} maxLength={160} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
              <label className="field-label" htmlFor="owner"><Icon name="user" size={15} />{t("ownerName")}</label>
              <input id="owner" autoComplete="name" required minLength={2} maxLength={120} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
              <label className="field-label" htmlFor="setup-email"><Icon name="mail" size={15} />{t("email")}</label>
              <input id="setup-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              <label className="field-label" htmlFor="setup-password"><Icon name="lock" size={15} />{t("password")} <span className="label-hint">{t("passwordMinimum")}</span></label>
              <input id="setup-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
              <label className="field-label" htmlFor="confirm-password"><Icon name="shield" size={15} />{t("confirmPassword")}</label>
              <input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              {error && setupRequired !== null && <div className="form-error" role="alert"><Icon name="alert" size={16} />{t(error)}</div>}
              <button className="action-button" type="submit" disabled={busy || setupRequired !== true}>{busy ? t("creatingWorkspace") : t("createOwner")}<Icon name="arrowRight" size={19} /></button>
            </form>
          )}
          {!complete && error && setupRequired === null && <div className="form-error setup-status-error" role="alert"><Icon name="alert" size={16}/>{t(error)}</div>}
          <p className="signup-note"><Link href="/"><Icon name="arrowLeft" size={14} />{t("backToSignIn")}</Link></p>
        </div>
      </section>
    </main>
  );
}
