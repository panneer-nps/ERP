"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { LanguageSwitcher, useLocale } from "./i18n";
import { BrickChamberIllustration, Icon } from "./visuals";
import type { TranslationKey } from "./i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/api/auth/setup-status`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Setup status unavailable.");
        const data = await response.json();
        if (active) setSetupRequired(data.setupRequired === true);
      })
      .catch(() => { if (active) setSetupRequired(false); });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setServerError("");
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "INVALID_CREDENTIALS") setError("invalidCredentials");
        else if (data.error?.code === "SERVICE_UNAVAILABLE") setError("databaseUnavailable");
        else if (data.error?.code === "MIGRATIONS_REQUIRED") setError("migrationsRequired");
        else if (data.error?.code === "DATA_CONFLICT") setError("databaseConflict");
        else setServerError(typeof data.error?.message === "string" ? data.error.message : t("signInFailed"));
        return;
      }
      for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(key?.startsWith("brick-erp-offline-"))sessionStorage.removeItem(key);}
      sessionStorage.setItem("brick-erp-session", data.token);
      window.location.assign("/dashboard");
    } catch {
      setError("serverUnavailable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="brand-panel">
        <BrickChamberIllustration />
        <div className="brand-mark">BC</div>
        <div className="eyebrow">{t("brand")}</div>
        <h1>{t("loginHeadline")}</h1>
        <p>{t("loginCopy")}</p>
        <div className="brand-footer">{t("loginFooter")}</div>
      </section>
      <section className="form-panel">
        <div className="language-switcher-floating"><LanguageSwitcher /></div>
        <form className="login-form" onSubmit={signIn}>
          <div className="eyebrow muted">{t("welcomeBack")}</div>
          <h2>{t("signInTitle")}</h2>
          <p className="subcopy">{t("signInHelp")}</p>
          <label className="field-label" htmlFor="email"><Icon name="mail" size={15} />{t("email")}</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="field-label" htmlFor="password"><Icon name="lock" size={15} />{t("password")}</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {(error || serverError) && <div className="form-error" role="alert"><Icon name="alert" size={16} />{error ? t(error) : serverError}</div>}
          <button className="action-button" type="submit" disabled={busy}>{busy ? t("signingIn") : t("signIn")}<Icon name="arrowRight" size={19} /></button>
          <p className="secure-note"><Icon name="shield" size={15} /> {t("secureAccess")}</p>
          {setupRequired && <p className="signup-note">{t("firstTimeQuestion")} <Link href="/setup">{t("createOwnerLink")}</Link></p>}
        </form>
      </section>
    </main>
  );
}
