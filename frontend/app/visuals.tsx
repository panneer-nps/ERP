import type { ReactNode } from "react";

export type IconName = "globe" | "mail" | "lock" | "building" | "user" | "users" | "handshake" | "plus" | "search" | "arrowRight" | "arrowLeft" | "shield" | "alert" | "bell" | "home" | "factory" | "boxes" | "chart" | "truck" | "calculator" | "settings" | "shopping" | "clock" | "calendar" | "cash" | "check" | "download" | "logout" | "receipt" | "trash" | "eye" | "eyeOff" | "pencil";

const iconArt: Record<IconName, ReactNode> = {
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/></>,
  building: <><path d="M4 21V5l8-3 8 3v16M2 21h20M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-4h4v4"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  users: <><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M16 5a3.5 3.5 0 0 1 0 7m2 2a6 6 0 0 1 4 6"/></>,
  handshake: <><path d="m3 12 4-4 4 2 3-2 7 4-4 5-4-2-3 2-7-5Z"/><path d="m7 8 3-3 5 1 3 2m-9 7 3 2m1-4 3 2m1-4 3 2"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  search: <><circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/></>,
  arrowRight: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
  arrowLeft: <><path d="M20 12H5m6 6-6-6 6-6"/></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/></>,
  factory: <><path d="M3 21V9l6 3V8l6 4V5h5v16ZM6 17h2m3 0h2m3 0h2M15 5V3h4v2"/></>,
  boxes: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5m-18 0v9l9 5 9-5V8m-9 5v9"/></>,
  chart: <><path d="M4 20V11h4v9m4 0V4h4v16m4 0v-7h4v7M2 20h21"/></>,
  truck: <><path d="M3 6h12v12H3zM15 10h4l3 4v4h-7z"/><circle cx="7.5" cy="19" r="2"/><circle cx="18.5" cy="19" r="2"/></>,
  calculator: <><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8v4H8zM8 14h1m3 0h1m3 0h1m-9 4h1m3 0h1m3 0h1"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z" transform="translate(-1 -1)"/></>,
  shopping: <><path d="M3 4h2l2.2 11.2A2 2 0 0 0 9.2 17H18a2 2 0 0 0 2-1.6L22 8H6"/><circle cx="10" cy="21" r="1"/><circle cx="18" cy="21" r="1"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 4h2m4 0h2m-8 3h2"/></>,
  cash: <><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/></>,
  check: <><path d="m5 12 4 4L19 6"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></>,
  logout: <><path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  receipt: <><path d="M5 3 7 5l2-2 2 2 2-2 2 2 2-2 2 2v18l-2-2-2 2-2-2-2 2-2-2-2 2Z"/><path d="M9 10h6m-6 4h6m-6 4h4"/></>,
  trash: <><path d="M3 6h18m-16 0 1 15h12l1-15M9 6V3h6v3m-5 4v7m4-7v7"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.4 0 2.6-.3 3.7-.8"/></>,
  pencil: <><path d="m14 5 5 5M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z"/></>,
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" focusable="false" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconArt[name]}</svg>;
}

export function BrickChamberIllustration() {
  return (
    <svg className="brick-illustration" viewBox="0 0 520 310" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="kiln" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#e6a16f"/><stop offset="1" stopColor="#b86448"/></linearGradient>
        <linearGradient id="ground" x1="0" x2="1"><stop stopColor="#6f906d"/><stop offset="1" stopColor="#314d39"/></linearGradient>
      </defs>
      <circle cx="393" cy="79" r="45" fill="#f2cb83" opacity=".8"/>
      <path d="M36 255c74-30 126-24 199-3 71 20 139 12 248-16v74H36Z" fill="url(#ground)" opacity=".8"/>
      <path d="M154 119h231v132H154z" fill="url(#kiln)" stroke="#f3c099" strokeWidth="3"/>
      <path d="M137 119 270 53l150 66Z" fill="#914f3c" stroke="#e7a179" strokeWidth="3"/>
      <path d="M343 94V38h32v70" fill="#a65b43" stroke="#efb28a" strokeWidth="3"/>
      <path d="M170 141h199m-199 26h199m-199 26h199m-199 26h199" fill="none" stroke="#f4c29d" strokeWidth="3" opacity=".72"/>
      <path d="M207 141v26m58-26v26m57-26v26m-86 0v26m58-26v26m57-26v26m-144 0v26m58-26v26m57-26v26" fill="none" stroke="#a85942" strokeWidth="2" opacity=".65"/>
      <path d="M231 251v-46a39 39 0 0 1 78 0v46Z" fill="#263e30" stroke="#f2bd91" strokeWidth="3"/>
      <path d="M242 251v-43a28 28 0 0 1 56 0v43" fill="none" stroke="#d88762" strokeWidth="2" opacity=".8"/>
      <g fill="#d88962" stroke="#f0b18a" strokeWidth="1.5"><path d="m68 226 52-12 45 15-52 14Z"/><path d="m68 226v18l45 15v-16Z"/><path d="m113 243 52-14v18l-52 12Z"/><path d="m395 228 44-11 37 12-45 13Z"/><path d="m395 228v17l36 13v-16Z"/><path d="m431 242 45-13v17l-45 12Z"/></g>
      <path d="M67 92c20-19 42-17 56 0m-47-20c22-18 46-17 62 0" fill="none" stroke="#c7d7b8" strokeWidth="3" strokeLinecap="round" opacity=".7"/>
    </svg>
  );
}



