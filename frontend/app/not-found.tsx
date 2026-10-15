"use client";

import { LanguageSwitcher, useLocale } from "./i18n";
import { BrickChamberIllustration, Icon } from "./visuals";

export default function NotFoundPage() {
  const { locale } = useLocale();
  const ta = locale === "ta";

  return <main className="recovery-page">
    <div className="recovery-language"><LanguageSwitcher /></div>
    <section className="recovery-card">
      <div className="recovery-art"><span className="recovery-mark">404</span><BrickChamberIllustration /><div><b>{ta ? "செங்கல் சூளை ERP" : "BRICK CHAMBER ERP"}</b><p>{ta ? "உங்கள் வணிகப் பணிகளை ஒரே இடத்தில் நிர்வகிக்கவும்." : "Your business, together in one workspace."}</p></div></div>
      <div className="recovery-copy">
        <span className="recovery-icon"><Icon name="search" size={25} /></span>
        <div className="eyebrow muted">404 · {ta ? "பக்கம் கிடைக்கவில்லை" : "PAGE NOT FOUND"}</div>
        <h1>{ta ? "இந்தப் பக்கம் கிடைக்கவில்லை" : "This page isn’t here"}</h1>
        <p>{ta ? "இணைப்பு பழையதாக இருக்கலாம் அல்லது முகவரியில் எழுத்துப் பிழை இருக்கலாம்." : "The link may be out of date, or the address may have a typo."}</p>
        <a className="recovery-primary recovery-link-primary" href="/dashboard"><Icon name="home" size={17} />{ta ? "கண்ணோட்டத்திற்குச் செல்" : "Go to overview"}<Icon name="arrowRight" size={17} /></a>
        <a className="recovery-secondary" href="/">{ta ? "உள்நுழைவுக்குச் செல்" : "Go to sign in"}<Icon name="arrowRight" size={16} /></a>
      </div>
    </section>
  </main>;
}
