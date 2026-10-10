import Link from "next/link";

export default function OfflinePage(){
  return <main className="offline-page"><section className="offline-card"><span className="offline-mark">BC</span><div className="eyebrow muted">BRICK CHAMBER ERP</div><h1>You’re offline</h1><p>Reconnect to continue using ERP transactions. Your cached dashboard summary may still be available.</p><hr/><h2>இணைய இணைப்பு இல்லை</h2><p>ERP பரிவர்த்தனைகளைத் தொடர இணையத்துடன் மீண்டும் இணைக்கவும். முன்பு பார்த்த சுருக்கம் கிடைக்கலாம்.</p><Link href="/dashboard">Open dashboard · முகப்புப் பலகையைத் திறக்கவும்</Link></section></main>;
}
