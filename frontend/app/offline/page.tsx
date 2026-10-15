"use client";

import Link from "next/link";
import { LanguageSwitcher, useLocale } from "../i18n";

export default function OfflinePage() {
  const { locale } = useLocale();
  const ta = locale === "ta";

  return <main className="offline-page"><section className="offline-card">
    <div className="offline-header"><span className="offline-mark">BC</span><LanguageSwitcher/></div>
    <div className="eyebrow muted">BRICK CHAMBER ERP</div>
    <h1>{ta ? "இணைய இணைப்பு இல்லை" : "You’re offline"}</h1>
    <p>{ta
      ? "ERP பரிவர்த்தனைகளைத் தொடர இணையத்துடன் மீண்டும் இணைக்கவும். முன்பு பார்த்த சுருக்கம் கிடைக்கலாம்."
      : "Reconnect to continue using ERP transactions. Your cached dashboard summary may still be available."}</p>
    <hr/>
    <Link href="/dashboard">{ta ? "முகப்புப் பலகையைத் திறக்கவும்" : "Open dashboard"}</Link>
  </section></main>;
}
