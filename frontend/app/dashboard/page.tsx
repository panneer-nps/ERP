"use client";

import { useEffect, useState } from "react";
import { LanguageSwitcher, useLocale } from "../i18n";
import { Icon, type IconName } from "../visuals";
import { MobileNavigation } from "../navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Profile = { fullName: string; email: string; roles: Array<{ code: string; name: string }> };
type ModuleCard = [number, string, string, string, boolean, IconName, string?];
type NavItem = [IconName, string];

export default function Dashboard() {
  const { locale, t } = useLocale();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token) { window.location.replace("/"); return; }
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        const data = await response.json();
        setProfile(data.user);
      })
      .catch(() => { sessionStorage.removeItem("brick-erp-session"); window.location.replace("/"); })
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    const token = sessionStorage.getItem("brick-erp-session");
    if (token) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    sessionStorage.removeItem("brick-erp-session");
    window.location.replace("/");
  }

  if (loading || !profile) return <main className="dashboard-loading">{t("loadingWorkspace")}</main>;

  const modules: ModuleCard[] = [
    [1, t("administration"), t("administrationDetail"), t("ready"), true, "settings"],
    [2, t("production"), t("productionDetail"), t("ready"), true, "factory", "/production"],
    [3, t("inventory"), t("inventoryDetail"), t("ready"), true, "boxes", "/production?view=stock"],
    [4, t("salesBilling"), t("salesBillingDetail"), t("ready"), true, "chart", "/sales"],
    [5, t("loadingDelivery"), t("loadingDeliveryDetail"), t("ready"), true, "truck", "/loading"],
    [6, t("purchasesExpenses"), t("purchasesDetail"), t("ready"), true, "shopping", "/purchases"],
    [7, t("expenses"), t("expensesDetail"), t("ready"), true, "calculator", "/expenses"],
    [8, t("reports"), t("reportsDetail"), t("ready"), true, "chart", "/reports"],
    [9, locale === "ta" ? "பணியாளர்கள்" : "People & attendance", locale === "ta" ? "பணியாளர் பதிவுகள், தினசரி வருகை மற்றும் முன்பணங்கள்" : "Employee records, daily attendance and staff advances.", t("ready"), true, "users", "/people"],
  ];
  const navItems: NavItem[] = [
    ["chart", t("salesLoading")],
    ["clock", t("labour")], ["shopping", t("purchasesExpenses")],
  ];

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <a className="sidebar-brand" href="/" aria-label="Brick Chamber ERP home"><span>BC</span><b>Brick Chamber<br />ERP</b></a>
        <div className="nav-label">{t("workspace").toUpperCase()}</div>
        <a className="nav-item active" href="/dashboard"><Icon name="home" size={17}/>{t("overview")}</a>
        <a className="nav-item" href="/people"><Icon name="users" size={17}/>{locale === "ta" ? "பணியாளர்கள் மற்றும் வருகை" : "People & attendance"}</a>
        <a className="nav-item" href="/production"><Icon name="factory" size={17}/>{t("production")}</a>
        <a className="nav-item" href="/production?view=stock"><Icon name="boxes" size={17}/>{t("stock")}</a>
        <a className="nav-item" href="/sales"><Icon name="chart" size={17}/>{t("salesLoading")}</a>
        <a className="nav-item" href="/loading"><Icon name="truck" size={17}/>{locale === "ta" ? "ஏற்றுதல் மற்றும் விநியோகம்" : "Loading & delivery"}</a>
        <a className="nav-item" href="/purchases"><Icon name="shopping" size={17}/>{t("purchasesExpenses")}</a>
        <a className="nav-item" href="/expenses"><Icon name="calculator" size={17}/>{t("expenses")}</a>
        <a className="nav-item" href="/reports"><Icon name="chart" size={17}/>{t("reports")}</a>
        <div className="nav-label space-top">{t("operations").toUpperCase()}</div>
        {navItems.map(([icon, label]) => <div className="nav-item disabled" key={label}><Icon name={icon} size={17}/>{label}<small>{t("planned")}</small></div>)}
        <div className="sidebar-bottom"><div className="avatar">{profile.fullName.slice(0, 1).toUpperCase()}</div><div className="user-meta"><b>{profile.fullName}</b><span>{profile.roles.map((role) => role.code === "owner" ? t("ownerRole") : role.name).join(", ") || t("teamMember")}</span></div><button className="signout" onClick={signOut} aria-label={t("signOut")}><Icon name="logout" size={17}/></button></div>
      </aside>
    <MobileNavigation active="home"/><section className="dashboard-main">
        <header className="topbar"><div className="breadcrumb">{t("workspace")} <span>/</span> {t("overview")}</div><div className="topbar-right"><LanguageSwitcher/><span className="system-status"><Icon name="check" size={15}/>{t("systemConnected")}</span><span className="top-avatar">{profile.fullName.slice(0, 1).toUpperCase()}</span></div></header>
        <div className="dashboard-content">
          <div className="welcome-row"><div><div className="eyebrow muted">{t("businessOverview")}</div><h1>{t("welcomeGreeting").replace("{name}", profile.fullName.split(" ")[0])}</h1><p>{t("dashboardIntro")}</p></div><div className="date-pill">{new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" }).format(new Date())}</div></div>
          <div className="setup-banner"><div className="setup-icon"><Icon name="shield" size={18}/></div><div><b>{t("workspaceReady")}</b><p>{t("workspaceReadyCopy")}</p></div><span className="setup-check"><Icon name="check" size={15}/></span></div>
          <div className="section-heading"><div><h2>{t("modulesTitle")}</h2><p>{t("modulesIntro")}</p></div><span className="phase-tag">{t("foundationPhase")}</span></div>
          <div className="module-grid">
            {modules.map(([number, title, detail, status, ready, icon, href]) => href ? <a className="module-card module-card-link" href={href} key={number}><div className="module-card-top"><span className="module-icon-tile"><Icon name={icon} size={20}/></span><span className={ready ? "module-status ready" : "module-status"}><i/>{status}</span></div><h3>{title}</h3><p>{detail}</p></a> : <article className="module-card" key={number}><div className="module-card-top"><span className="module-icon-tile"><Icon name={icon} size={20}/></span><span className={ready ? "module-status ready" : "module-status"}><i/>{status}</span></div><h3>{title}</h3><p>{detail}</p></article>)}
          </div>
          <footer className="dash-footer">Brick Chamber ERP <span>·</span> {t("dashboardFooter")}</footer>
        </div>
      </section>
    </main>
  );
}




