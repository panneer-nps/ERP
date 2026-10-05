"use client";

import { FormEvent, useState } from "react";
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
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.code === "INVALID_CREDENTIALS" ? "invalidCredentials" : "signInFailed");
        return;
      }
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
          {error && <div className="form-error" role="alert"><Icon name="alert" size={16} />{t(error)}</div>}
          <button className="action-button" type="submit" disabled={busy}>{busy ? t("signingIn") : t("signIn")}<Icon name="arrowRight" size={19} /></button>
          <p className="secure-note"><Icon name="shield" size={15} /> {t("secureAccess")}</p>
          <p className="signup-note">{t("firstTimeQuestion")} <Link href="/setup">{t("createOwnerLink")}</Link></p>
        </form>
      </section>
    </main>
  );
}
