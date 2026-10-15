"use client";

import { useEffect } from "react";
import { LanguageSwitcher, useLocale } from "./i18n";
import { BrickChamberIllustration, Icon } from "./visuals";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useLocale();
  const ta = locale === "ta";

  useEffect(() => {
    // Keep diagnostics useful without exposing exception details to business users.
    console.error("ERP page rendering failed", { digest: error.digest });
  }, [error.digest]);

  return <main className="recovery-page">
    <div className="recovery-language"><LanguageSwitcher /></div>
    <section className="recovery-card" role="alert">
      <div className="recovery-art"><span className="recovery-mark">BC</span><BrickChamberIllustration /><div><b>{ta ? "செங்கல் சூளை ERP" : "BRICK CHAMBER ERP"}</b><p>{ta ? "உங்கள் வணிகப் பணிகளை மீண்டும் தொடருங்கள்." : "Get back to your business workspace."}</p></div></div>
      <div className="recovery-copy">
        <span className="recovery-icon"><Icon name="alert" size={25} /></span>
        <div className="eyebrow muted">{ta ? "தற்காலிகச் சிக்கல்" : "TEMPORARY ISSUE"}</div>
        <h1>{ta ? "இந்தப் பக்கத்தைத் திறக்க முடியவில்லை" : "We couldn’t open this page"}</h1>
        <p>{ta ? "உங்கள் தரவு மாற்றப்படவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது உள்நுழைவுத் திரைக்குச் செல்லவும்." : "Your data has not been changed. Try again, or return to sign in."}</p>
        <button className="recovery-primary" type="button" onClick={reset}><Icon name="clock" size={17} />{ta ? "மீண்டும் முயற்சி" : "Try again"}<Icon name="arrowRight" size={17} /></button>
        <a className="recovery-secondary" href="/">{ta ? "உள்நுழைவுக்குச் செல்" : "Go to sign in"}<Icon name="arrowRight" size={16} /></a>
      </div>
    </section>
  </main>;
}
