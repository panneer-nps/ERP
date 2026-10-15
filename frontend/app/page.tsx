"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { LanguageSwitcher, localizedApiError, useLocale } from "./i18n";
import { BrickChamberIllustration, Icon } from "./visuals";
import { MigrationHelp } from "./migration-help";
import type { TranslationKey } from "./i18n";

const API_URL = "";

export default function Home() {
  const { t, locale } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [serverError, setServerError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [statusWarning, setStatusWarning] = useState<TranslationKey | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/api/auth/setup-status`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          setSetupRequired(false);
          const code = data?.error?.code;
          if (code === "DATABASE_CONFIGURATION") setStatusWarning("databaseConfiguration");
          else if (code === "SERVICE_UNAVAILABLE") setStatusWarning("databaseUnavailable");
          else if (code === "MIGRATIONS_REQUIRED") setStatusWarning("migrationsRequired");
          else if (code === "INTERNAL_ERROR") {
            setStatusWarning("serverRequestFailed");
            setErrorReference(typeof data.error.requestId === "string" ? data.error.requestId : "");
          } else setStatusWarning("serverUnavailable");
          return;
        }
        setSetupRequired(data?.setupRequired === true);
        if (data?.migrationsRequired === true) setStatusWarning("migrationsRequired");
      })
      .catch(() => {
        if (active) {
          setSetupRequired(false);
          setStatusWarning("serverUnavailable");
        }
      });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setServerError("");
    setErrorReference("");
    setStatusWarning(null);
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(mfaChallenge ? { challenge: mfaChallenge, code: mfaCode } : {}) }),
      });
      const data = await response.json();
      if (response.status === 202 && data?.mfaRequired === true && typeof data.challenge === "string") {
        setMfaChallenge(data.challenge);
        setMfaCode("");
        setServerError("");
        return;
      }
      if (!response.ok) {
        if (data.error?.code === "INVALID_CREDENTIALS") setError(mfaChallenge ? "invalidSecondFactor" : "invalidCredentials");
        else if (data.error?.code === "SERVICE_UNAVAILABLE") setError("databaseUnavailable");
        else if (data.error?.code === "DATABASE_CONFIGURATION") setError("databaseConfiguration");
        else if (data.error?.code === "MIGRATIONS_REQUIRED") setError("migrationsRequired");
        else if (data.error?.code === "DATA_CONFLICT") setError("databaseConflict");
        else if (data.error?.code === "INTERNAL_ERROR") {
          setError("serverRequestFailed");
          setErrorReference(typeof data.error.requestId === "string" ? data.error.requestId : "");
        }
        else setServerError(localizedApiError(locale, data.error?.code, data.error?.message, t("signInFailed")));
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
          {statusWarning && <div className="form-error" role="status"><Icon name="alert" size={16} /><div><span>{t(statusWarning)}{errorReference && <small className="error-reference">{t("errorReference")}: {errorReference}</small>}</span>{statusWarning === "migrationsRequired" && <MigrationHelp/>}</div></div>}
          <label className="field-label" htmlFor="email"><Icon name="mail" size={15} />{t("email")}</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="field-label" htmlFor="password"><Icon name="lock" size={15} />{t("password")}</label>
          <div className="password-input-wrap"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? t("hidePassword") : t("showPassword")} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? "eyeOff" : "eye"} size={17}/></button></div>
          {mfaChallenge && <><label className="field-label" htmlFor="authenticator-code"><Icon name="shield" size={15} />{t("authenticatorCode")}</label><input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}|[A-Fa-f0-9-]{20,24}" required value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /><small className="field-help">{t("authenticatorHelp")}</small><button type="button" className="master-toggle" onClick={() => { setMfaChallenge(""); setMfaCode(""); }}>{t("differentAccount")}</button></>}
          {(error || serverError) && <div className="form-error" role="alert"><Icon name="alert" size={16} /><div><span>{error ? t(error) : serverError}{errorReference && <small className="error-reference">{t("errorReference")}: {errorReference}</small>}</span>{error === "migrationsRequired" && <MigrationHelp/>}</div></div>}
          <button className="action-button" type="submit" disabled={busy}>{busy ? t("signingIn") : mfaChallenge ? t("verifyAndSignIn") : t("signIn")}<Icon name="arrowRight" size={19} /></button>
          <p className="secure-note"><Icon name="shield" size={15} /> {t("secureAccess")}</p>
          {setupRequired && <p className="signup-note">{t("firstTimeQuestion")} <Link href="/setup">{t("createOwnerLink")}</Link></p>}
        </form>
      </section>
    </main>
  );
}
