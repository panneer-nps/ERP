"use client";

import { useEffect, useState } from "react";
import { LanguageSwitcher, useLocale } from "../i18n";
import { Icon, type IconName } from "../visuals";
import { CompanyBrand, MobileNavigation } from "../navigation";
import { dashboardSummaryCacheKey, dashboardSummaryMatchesScope, readDashboardBranchScope } from "../dashboard-cache";

const API_URL = "";
type Profile = { fullName: string; email: string; companyName?:string; roles: Array<{ code: string; name: string }>; permissions?:string[] };
type ModuleCard = [number, string, string, string, boolean, IconName, string?];
type NavItem = [IconName, string];
type DashboardSummary = { branchId:string|null; sales:string|null; collections:string|null; expenses:string|null; receivables:string|null; stock:{productCount:number;value:string;unvaluedProductCount:number}|null; production:{batches:number;saleable:string|null;unit:string|null}|null; chambers:{total:number;available:number;maintenance:number;outOfService:number}|null; ownerPulse?:{supplierPayable:string;cashBalance:string;bankBalance:string;employeeAdvanceBalance:string;salaryPayable:string;brokerPayable:string;activeLoadings:number;loadingMismatches:number;asOfDate:string;scope:"company"|"branch"}|null; pendingApprovals:number|null; from:string;to:string };
function localDateInput(value:Date){const offset=value.getTimezoneOffset();return new Date(value.getTime()-offset*60_000).toISOString().slice(0,10)}
const OFFLINE_CACHE_MAX_AGE=24*60*60*1000;
function tokenFingerprint(token:string){return `${token.length}:${token.slice(0,12)}:${token.slice(-12)}`}
function readOfflineProfile(token:string):{profile:Profile;savedAt:string}|null{try{const value=JSON.parse(sessionStorage.getItem("brick-erp-offline-profile")??"null") as {fingerprint?:string;savedAt?:string;profile?:Profile}|null;const age=value?.savedAt?Date.now()-Date.parse(value.savedAt):NaN;if(!value||value.fingerprint!==tokenFingerprint(token)||!Number.isFinite(age)||age<0||age>OFFLINE_CACHE_MAX_AGE||!value.profile)return null;return{profile:value.profile,savedAt:value.savedAt!}}catch{return null}}
const OFFLINE_BRANCH_SCOPE_KEY="brick-erp-offline-branch-scope";
function readOfflineBranchScope(token:string):{branchId:string|null;savedAt:string}|null{try{const value=JSON.parse(sessionStorage.getItem(OFFLINE_BRANCH_SCOPE_KEY)??"null") as {fingerprint?:unknown;branchId?:unknown;savedAt?:unknown}|null;return readDashboardBranchScope(value,tokenFingerprint(token),Date.now(),OFFLINE_CACHE_MAX_AGE)}catch{return null}}
function writeOfflineBranchScope(token:string,branchId:string|null){try{sessionStorage.setItem(OFFLINE_BRANCH_SCOPE_KEY,JSON.stringify({fingerprint:tokenFingerprint(token),branchId,savedAt:new Date().toISOString()}))}catch{/* Continue online when browser storage is unavailable. */}}
function readOfflineSummary(token:string,from:string,to:string,branchId:string|null):{summary:DashboardSummary;savedAt:string}|null{try{const scope={from,to,branchId};const value=JSON.parse(sessionStorage.getItem(dashboardSummaryCacheKey(tokenFingerprint(token),scope))??"null") as {savedAt?:string;summary?:DashboardSummary}|null;const age=value?.savedAt?Date.now()-Date.parse(value.savedAt):NaN;if(!value||!Number.isFinite(age)||age<0||age>OFFLINE_CACHE_MAX_AGE||!dashboardSummaryMatchesScope(value.summary,scope))return null;return{summary:value.summary!,savedAt:value.savedAt!}}catch{return null}}

export default function Dashboard() {
  const { locale, t } = useLocale();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [branchScope,setBranchScope]=useState<{branchId:string|null;ready:boolean;available:boolean}>({branchId:null,ready:false,available:false});
  const [summaryError, setSummaryError] = useState(false);
  const [summaryFailure, setSummaryFailure] = useState("");
  const [isOnline,setIsOnline]=useState(true);
  const [usingCachedSummary,setUsingCachedSummary]=useState(false);
  const [usingCachedProfile,setUsingCachedProfile]=useState(false);
  const [summaryCachedAt,setSummaryCachedAt]=useState<string|null>(null);
  const [profileUnavailable,setProfileUnavailable]=useState(false);
  const [notificationCount,setNotificationCount]=useState(0);
  const today = localDateInput(new Date());
  const [fromDate,setFromDate]=useState(()=>localDateInput(new Date(new Date().getFullYear(),new Date().getMonth(),1)));
  const [toDate,setToDate]=useState(today);
  const [appliedRange,setAppliedRange]=useState(()=>({from:localDateInput(new Date(new Date().getFullYear(),new Date().getMonth(),1)),to:localDateInput(new Date())}));

  useEffect(() => {
    let active=true;const token=sessionStorage.getItem("brick-erp-session");
    if(!token){window.location.replace("/");return()=>{active=false};}
    const loadProfile=async()=>{try{const response=await fetch(`${API_URL}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});if(response.status===401||response.status===403||response.status===409){sessionStorage.removeItem("brick-erp-session");sessionStorage.removeItem("brick-erp-offline-profile");window.location.replace("/");return;}if(!response.ok)throw new Error("profile unavailable");const data=await response.json();if(!active)return;setProfile(data.user);try{sessionStorage.setItem("brick-erp-offline-profile",JSON.stringify({fingerprint:tokenFingerprint(token),savedAt:new Date().toISOString(),profile:data.user}));}catch{/* Private browsing may disable browser storage. */}}
      catch{if(!active)return;const cached=readOfflineProfile(token);if(cached){setProfile(cached.profile);setUsingCachedProfile(true);}else setProfileUnavailable(true);}
      finally{if(active)setLoading(false)}};
    void loadProfile();return()=>{active=false};
  }, []);

  useEffect(()=>{const update=()=>setIsOnline(navigator.onLine);update();window.addEventListener("online",update);window.addEventListener("offline",update);return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update)}},[]);

  useEffect(()=>{if(!profile)return;const token=sessionStorage.getItem("brick-erp-session");if(!token)return;let active=true;const cached=readOfflineBranchScope(token);if(!isOnline){setBranchScope({branchId:cached?.branchId??null,ready:true,available:Boolean(cached)});return()=>{active=false};}fetch(`${API_URL}/api/auth/branches`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("branch scope unavailable");return response.json()}).then(data=>{if(!active)return;const branchId=(data.currentBranchId??null) as string|null;writeOfflineBranchScope(token,branchId);setBranchScope({branchId,ready:true,available:true})}).catch(()=>{if(active)setBranchScope({branchId:cached?.branchId??null,ready:true,available:Boolean(cached)})});return()=>{active=false}},[profile,isOnline]);

  useEffect(()=>{if(!isOnline||!usingCachedProfile)return;const token=sessionStorage.getItem("brick-erp-session");if(!token)return;let active=true;fetch(`${API_URL}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(async response=>{if(response.status===401||response.status===403||response.status===409){sessionStorage.removeItem("brick-erp-session");window.location.replace("/");return null}if(!response.ok)throw new Error("profile unavailable");return response.json()}).then(data=>{if(!active||!data)return;setProfile(data.user);setUsingCachedProfile(false);sessionStorage.setItem("brick-erp-offline-profile",JSON.stringify({fingerprint:tokenFingerprint(token),savedAt:new Date().toISOString(),profile:data.user}))}).catch(()=>undefined);return()=>{active=false}},[isOnline,usingCachedProfile]);

  useEffect(()=>{const token=sessionStorage.getItem("brick-erp-session");if(!token)return;fetch(`${API_URL}/api/notifications`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(d)setNotificationCount(Number(d.unreadCount)||0)}).catch(()=>undefined)},[]);

  useEffect(() => {
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token) return;
    if(!branchScope.ready)return;const {from,to}=appliedRange;let active=true;const branchId=branchScope.branchId;const cached=branchScope.available?readOfflineSummary(token,from,to,branchId):null;setSummary(cached?.summary??null);setSummaryCachedAt(cached?.savedAt??null);setUsingCachedSummary(false);setSummaryError(false);setSummaryFailure("");
    if(!branchScope.available){setSummaryError(true);setSummaryFailure("Branch scope is unavailable");return()=>{active=false};}
    if(!isOnline){if(cached){setUsingCachedSummary(true);setIsOnline(false)}else setSummaryError(true);return()=>{active=false};}
    fetch(`${API_URL}/api/dashboard/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async response=>{if(response.status===401){sessionStorage.removeItem("brick-erp-session");sessionStorage.removeItem("brick-erp-offline-profile");window.location.replace("/");throw new Error("session expired");}if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
      .then(data=>{if(!active)return;const scope={from,to,branchId};if(!dashboardSummaryMatchesScope(data,scope))throw new Error("Dashboard branch scope mismatch");setSummary(data);setSummaryError(false);setUsingCachedSummary(false);const savedAt=new Date().toISOString();setSummaryCachedAt(savedAt);try{sessionStorage.setItem(dashboardSummaryCacheKey(tokenFingerprint(token),scope),JSON.stringify({savedAt,summary:data}))}catch{/* Continue online when session storage is full or disabled. */}})
      .catch(error=>{if(!active||error instanceof Error&&error.message==="session expired")return;if(cached){setSummary(cached.summary);setSummaryCachedAt(cached.savedAt);setUsingCachedSummary(true);setSummaryError(false);}else{setSummaryError(true);setSummaryFailure(error instanceof Error?error.message:"Network error")}});
    return()=>{active=false};
  }, [appliedRange,isOnline,branchScope]);

  function applyDashboardRange(){if(fromDate<=toDate)setAppliedRange({from:fromDate,to:toDate})}

  async function signOut() {
    const token = sessionStorage.getItem("brick-erp-session");
    if (token) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    sessionStorage.removeItem("brick-erp-session");
    for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(key?.startsWith("brick-erp-offline-"))sessionStorage.removeItem(key);}
    window.location.replace("/");
  }

  if (loading) return <main className="dashboard-loading">{t("loadingWorkspace")}</main>;
  if (!profile) return <main className="dashboard-loading"><div>{profileUnavailable?t("offlineProfileUnavailable"):t("loadingWorkspace")}<p><a href="/">{t("signInTitle")}</a></p></div></main>;

  const offlineMode=!isOnline||usingCachedProfile||usingCachedSummary;
  const cachedTime=summaryCachedAt?new Intl.DateTimeFormat(locale==="ta"?"ta-IN":"en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(summaryCachedAt)):null;
  const formatMoney=(value:string)=>new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(value));
  const ownerPulseDate=(value:string)=>new Intl.DateTimeFormat(locale==="ta"?"ta-IN":"en-IN",{dateStyle:"medium",timeZone:"Asia/Kolkata"}).format(new Date(`${value}T12:00:00+05:30`));
  const canAny=(...codes:string[])=>codes.some(code=>profile.permissions?.includes(code));

  const modules: ModuleCard[] = [
    [1, t("administration"), t("administrationDetail"), t("ready"), true, "settings"],
    [2, t("production"), t("productionDetail"), t("ready"), true, "factory", "/production"],
    [3, t("inventory"), t("inventoryDetail"), t("ready"), true, "boxes", "/reports/stock"],
    [4, t("salesBilling"), t("salesBillingDetail"), t("ready"), true, "chart", "/sales"],
    [5, t("loadingDelivery"), t("loadingDeliveryDetail"), t("ready"), true, "truck", "/loading"],
    [6, t("purchasesExpenses"), t("purchasesDetail"), t("ready"), true, "shopping", "/purchases"],
    [7, t("expenses"), t("expensesDetail"), t("ready"), true, "calculator", "/expenses"],
    [8, t("reports"), t("reportsDetail"), t("ready"), true, "chart", "/reports"],
    [9, locale === "ta" ? "பணியாளர்கள்" : "People & attendance", locale === "ta" ? "பணியாளர் பதிவுகள், தினசரி வருகை மற்றும் முன்பணங்கள்" : "Employee records, daily attendance and staff advances.", t("ready"), true, "users", "/people"],
    [10, locale === "ta" ? "தரகர் கமிஷன்" : "Broker commissions", locale === "ta" ? "கமிஷன் விதிகள், ஒப்புதல், நிலுவை மற்றும் பணம் செலுத்துதல்" : "Commission rules, accrual approvals, payables and broker payments.", t("ready"), true, "handshake", "/brokers"],
    [13, locale === "ta" ? "சரக்கு திரும்பப் பெறல்" : "Customer stock returns", locale === "ta" ? "விலைப்பட்டியல் கடன் இல்லாமல் வாடிக்கையாளரிடமிருந்து திரும்பிய செங்கற்களைப் பதிவு செய்யவும்." : "Receive and value returned bricks without creating an invoice credit.", t("ready"), true, "receipt", "/stock-returns"],
  ];
  const modulePermissions:Record<number,string[]>={2:["production.view","production.create"],3:["stock.view"],4:["sales.view","sales.create"],5:["loading.view","loading.create"],6:["purchases.view","purchases.create"],7:["expenses.view","expenses.create"],8:["sales.view","stock.view","production.view","purchases.view","accounting.view","audit.view"],9:["employees.view","attendance.view"],10:["brokers.commission.view"],13:["stock.return.create"]};
  for(let index=modules.length-1;index>=0;index--){const [number]=modules[index];const required=modulePermissions[number];if(required&&!canAny(...required))modules.splice(index,1)}
  if(!canAny("users.view","users.create","users.roles.manage"))modules.splice(0,1);
  if(profile.roles.some(role=>role.code==="owner"))modules.push([12,locale==="ta"?"நிறுவன விவரம்":"Company profile",locale==="ta"?"நிறுவன சட்டப்பூர்வ பெயர், முகவரி மற்றும் வரி விவரங்களை நிர்வகிக்கவும்":"Maintain company legal identity, address, tax details and timezone.",t("ready"),true,"building","/admin/company"]);
  if(profile.roles.some(role=>role.code==="owner"))modules.push([14,locale==="ta"?"உரிமையாளர் உதவியாளர்":"Owner assistant",locale==="ta"?"அங்கீகரிக்கப்பட்ட ERP பதிவுகளிலிருந்து வணிகக் கேள்விகளைக் கேளுங்கள்":"Ask business questions using approved, read-only ERP records.",t("ready"),true,"chart","/assistant"]);
  const canReviewApprovals=profile.permissions?.some(code=>["expenses.approve","stocktake.approve","cash.close.approve","loading.approve","brokers.commission.approve","sales.approve","employees.advance.approve","accounting.journal.approve","payroll.approve"].includes(code))??false;
  if(canReviewApprovals)modules.push([11,locale==="ta"?"ஒப்புதல் மையம்":"Approval center",locale==="ta"?"செலவு, சரக்கு, ரொக்கம் மற்றும் விநியோக ஒப்புதல்கள்":"Review pending expense, stock, cash and dispatch approvals.",t("ready"),true,"check","/approvals"]);
  const navItems: NavItem[] = [
    ["chart", t("salesLoading")],
    ["clock", t("labour")], ["shopping", t("purchasesExpenses")],
  ];

  return (
    <main className={`dashboard-shell${offlineMode?" offline-mode":""}`}>
      <aside className="sidebar">
        <CompanyBrand href="/" />
        <nav className="sidebar-navigation" inert={offlineMode}>
        <div className="nav-label">{t("workspace").toUpperCase()}</div>
        <a className="nav-item active" href="/dashboard"><Icon name="home" size={17}/>{t("overview")}</a>
        <a className="nav-item" href="/notifications"><Icon name="bell" size={17}/>{locale==="ta"?"அறிவிப்புகள்":"Notifications"}{notificationCount>0&&<small className="nav-notification-count">{notificationCount>99?"99+":notificationCount}</small>}</a>
        <a className="nav-item" href="/account/sessions"><Icon name="shield" size={17}/>{locale==="ta"?"எனது சாதனங்கள்":"My devices"}</a>
        {canReviewApprovals&&<a className="nav-item" href="/approvals"><Icon name="check" size={17}/>{locale==="ta"?"ஒப்புதல் மையம்":"Approval center"}</a>}
        {profile.roles.some(role=>role.code==="owner")&&<a className="nav-item" href="/assistant"><Icon name="chart" size={17}/>{locale==="ta"?"உரிமையாளர் உதவியாளர்":"Owner assistant"}</a>}
        {canAny("employees.view","attendance.view")&&<a className="nav-item" href="/people"><Icon name="users" size={17}/>{locale === "ta" ? "பணியாளர்கள் மற்றும் வருகை" : "People & attendance"}</a>}{canAny("brokers.commission.view")&&<a className="nav-item" href="/brokers"><Icon name="handshake" size={17}/>{locale === "ta" ? "தரகர் கமிஷன்" : "Broker commissions"}</a>}
        {canAny("production.view","production.create")&&<a className="nav-item" href="/production"><Icon name="factory" size={17}/>{t("production")}</a>}
        {canAny("stock.view")&&<a className="nav-item" href="/reports/stock"><Icon name="boxes" size={17}/>{t("stock")}</a>}
        {canAny("sales.view","sales.create")&&<a className="nav-item" href="/sales"><Icon name="chart" size={17}/>{t("salesLoading")}</a>}
        {canAny("loading.view","loading.create")&&<a className="nav-item" href="/loading"><Icon name="truck" size={17}/>{locale === "ta" ? "ஏற்றுதல் மற்றும் விநியோகம்" : "Loading & delivery"}</a>}
        {canAny("purchases.view","purchases.create")&&<a className="nav-item" href="/purchases"><Icon name="shopping" size={17}/>{t("purchasesExpenses")}</a>}
        {canAny("expenses.view","expenses.create")&&<a className="nav-item" href="/expenses"><Icon name="calculator" size={17}/>{t("expenses")}</a>}
        {canAny("sales.view","stock.view","production.view","purchases.view","accounting.view","audit.view")&&<a className="nav-item" href="/reports"><Icon name="chart" size={17}/>{t("reports")}</a>}
        <div className="nav-label space-top">{t("operations").toUpperCase()}</div>
        {navItems.map(([icon, label]) => <div className="nav-item disabled" key={label}><Icon name={icon} size={17}/>{label}<small>{t("planned")}</small></div>)}
        </nav>
        <div className="sidebar-bottom"><div className="avatar">{profile.fullName.slice(0, 1).toUpperCase()}</div><div className="user-meta"><b>{profile.fullName}</b><span>{profile.roles.map((role) => role.code === "owner" ? t("ownerRole") : role.name).join(", ") || t("teamMember")}</span></div><button className="signout" onClick={signOut} aria-label={t("signOut")}><Icon name="logout" size={17}/></button></div>
      </aside>
    <MobileNavigation active="home" disabled={offlineMode}/><section className="dashboard-main">
        <header className="topbar"><div className="breadcrumb">{t("workspace")} <span>/</span> {t("overview")}</div><div className="topbar-right"><LanguageSwitcher/>{offlineMode?<span className="notification-bell-link" aria-label={locale==="ta"?"அறிவிப்புகள்":"Notifications"} aria-disabled="true"><Icon name="bell" size={18}/>{notificationCount>0&&<span>{notificationCount>99?"99+":notificationCount}</span>}</span>:<a className="notification-bell-link" href="/notifications" aria-label={locale==="ta"?"அறிவிப்புகள்":"Notifications"}><Icon name="bell" size={18}/>{notificationCount>0&&<span>{notificationCount>99?"99+":notificationCount}</span>}</a>}<span className={`system-status${offlineMode?" offline":""}`}><Icon name={offlineMode?"alert":"check"} size={15}/>{offlineMode?t("offlineLabel"):t("systemConnected")}</span><span className="top-avatar">{profile.fullName.slice(0, 1).toUpperCase()}</span></div></header>
        <div className="dashboard-content">
          <div className="welcome-row"><div><div className="eyebrow muted">{t("businessOverview")}</div><h1>{t("welcomeGreeting").replace("{name}", profile.fullName.split(" ")[0])}</h1><p>{t("dashboardIntro")}</p></div><div className="date-pill">{new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" }).format(new Date())}</div></div>
          {offlineMode&&<div className="offline-banner" role="status"><span><Icon name="alert" size={18}/></span><div><b>{t("offlineCachedTitle")}</b><p>{summary? t("offlineCachedCopy").replace("{time}",cachedTime??""):t("offlineNoSummary")}</p></div></div>}
          <div className="setup-banner"><div className="setup-icon"><Icon name="shield" size={18}/></div><div><b>{t("workspaceReady")}</b><p>{t("workspaceReadyCopy")}</p></div><span className="setup-check"><Icon name="check" size={15}/></span></div>
          <div className="section-heading dashboard-kpi-heading"><div><h2>{t("dashboardKpis")}</h2><p>{t("dashboardPeriod")}</p></div><div className="dashboard-date-range"><label>{t("fromDate")}<input type="date" value={fromDate} max={toDate} onChange={e=>setFromDate(e.target.value)}/></label><label>{t("toDate")}<input type="date" value={toDate} min={fromDate} max={today} onChange={e=>setToDate(e.target.value)}/></label><button type="button" className="master-toggle" disabled={offlineMode||fromDate>toDate||fromDate===appliedRange.from&&toDate===appliedRange.to} onClick={applyDashboardRange}>{t("applyDateRange")}</button></div></div>
          {summaryError&&!summary?<div className="dashboard-summary-note" role="status">{offlineMode?t("offlineNoSummary"):t("dashboardSummaryError")}{summaryFailure&&<small className="dashboard-summary-failure">{summaryFailure}</small>}</div>:!summary?<div className="dashboard-summary-note" role="status">{t("dashboardLoading")}</div>:<div className="dashboard-kpi-grid">
            {summary.sales!==null&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon green"><Icon name="receipt" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardSales")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(summary.sales))}</strong></article>}
            {summary.collections!==null&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon blue"><Icon name="cash" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardCollections")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(summary.collections))}</strong></article>}
            {summary.expenses!==null&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon orange"><Icon name="calculator" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardExpenses")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(summary.expenses))}</strong></article>}
            {summary.receivables!==null&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon red"><Icon name="users" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardReceivables")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(summary.receivables))}</strong></article>}
            {summary.stock&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon violet"><Icon name="boxes" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardStock")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.stock.productCount)} {t("dashboardStockProducts")}</strong><small>{t("dashboardStockValue")}: {new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(summary.stock.value))} · {t("dashboardUnvalued")}: {new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.stock.unvaluedProductCount)} {t("dashboardProducts")}</small></article>}
            {summary.production&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon brick"><Icon name="factory" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardProduction")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.production.batches)} · {t("dashboardBatches")}</strong><small>{summary.production.saleable===null?t("dashboardMixedUnits"): `${new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN",{maximumFractionDigits:0}).format(Number(summary.production.saleable))} ${summary.production.unit??""} · ${t("dashboardProduction")}`}</small></article>}
            {summary.chambers&&<article className="dashboard-kpi-card"><span className="dashboard-kpi-icon teal"><Icon name="building" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardChambers")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.chambers.total)}</strong><small>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.chambers.available)} {t("dashboardAvailable")}</small></article>}
            {canReviewApprovals&&summary.pendingApprovals!==null&&(offlineMode?<article className="dashboard-kpi-card" aria-disabled="true"><span className="dashboard-kpi-icon gold"><Icon name="check" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardPending")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.pendingApprovals)}</strong></article>:<a className="dashboard-kpi-card dashboard-kpi-link" href="/approvals"><span className="dashboard-kpi-icon gold"><Icon name="check" size={19}/></span><span className="dashboard-kpi-label">{t("dashboardPending")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.pendingApprovals)}</strong></a>)}
          </div>}
          {summary?.ownerPulse&&<>
            <div className="section-heading"><div><h2>{t("ownerPulseTitle")}</h2><p>{t("ownerPulseAsOf").replace("{date}",ownerPulseDate(summary.ownerPulse.asOfDate)).replace("{scope}",t(summary.ownerPulse.scope==="branch"?"ownerPulseBranch":"ownerPulseCompany"))}</p></div></div>
            {!offlineMode&&Number(summary.ownerPulse.cashBalance)<0&&<div className="dashboard-cash-warning" role="status"><span className="dashboard-cash-warning-icon"><Icon name="alert" size={19}/></span><div><strong>{t("negativeCashTitle")}</strong><p>{t("negativeCashCopy")}</p><a href="/reports/cash-bank-book">{t("negativeCashLink")}</a></div></div>}
            <div className="dashboard-kpi-grid dashboard-owner-pulse-grid">
              <a className={`dashboard-kpi-card dashboard-kpi-link dashboard-owner-pulse-link${offlineMode?" offline-disabled":""}`} href="/purchases" aria-disabled={offlineMode} onClick={event=>{if(offlineMode)event.preventDefault()}}><span className="dashboard-kpi-icon orange"><Icon name="shopping" size={19}/></span><span className="dashboard-kpi-label">{t("ownerPulseSupplier")}</span><strong>{formatMoney(summary.ownerPulse.supplierPayable)}</strong><small>{t("ownerPulseBalanceAsOf").replace("{date}",ownerPulseDate(summary.ownerPulse.asOfDate))}</small></a>
              <a className={`dashboard-kpi-card dashboard-kpi-link dashboard-owner-pulse-link${offlineMode?" offline-disabled":""}`} href="/accounting/accounts" aria-disabled={offlineMode} onClick={event=>{if(offlineMode)event.preventDefault()}}><span className="dashboard-kpi-icon blue"><Icon name="cash" size={19}/></span><span className="dashboard-kpi-label">{t("ownerPulseCashBank")}</span><strong>{t("ownerPulseCash")}: {formatMoney(summary.ownerPulse.cashBalance)}</strong><small>{t("ownerPulseBank")}: {formatMoney(summary.ownerPulse.bankBalance)} · {ownerPulseDate(summary.ownerPulse.asOfDate)}</small></a>
              <a className={`dashboard-kpi-card dashboard-kpi-link dashboard-owner-pulse-link${offlineMode?" offline-disabled":""}`} href="/loading" aria-disabled={offlineMode} onClick={event=>{if(offlineMode)event.preventDefault()}}><span className={`dashboard-kpi-icon ${summary.ownerPulse.loadingMismatches>0?"red":"teal"}`}><Icon name="truck" size={19}/></span><span className="dashboard-kpi-label">{t("ownerPulseLoading")}</span><strong>{new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.ownerPulse.activeLoadings)} {t("ownerPulseOpenLoadings")}</strong><small>{t("ownerPulseOpenAsOf").replace("{date}",ownerPulseDate(summary.to))} · {t("ownerPulseMismatches")}: {new Intl.NumberFormat(locale==="ta"?"ta-IN":"en-IN").format(summary.ownerPulse.loadingMismatches)} ({ownerPulseDate(summary.from)}–{ownerPulseDate(summary.to)})</small></a>
              <a className={`dashboard-kpi-card dashboard-kpi-link dashboard-owner-pulse-link${offlineMode?" offline-disabled":""}`} href="/brokers" aria-disabled={offlineMode} onClick={event=>{if(offlineMode)event.preventDefault()}}><span className="dashboard-kpi-icon violet"><Icon name="handshake" size={19}/></span><span className="dashboard-kpi-label">{t("ownerPulseBroker")}</span><strong>{formatMoney(summary.ownerPulse.brokerPayable)}</strong><small>{t("ownerPulseRange").replace("{from}",ownerPulseDate(summary.from)).replace("{to}",ownerPulseDate(summary.to))}</small></a>
              <a className={`dashboard-kpi-card dashboard-kpi-link dashboard-owner-pulse-link${offlineMode?" offline-disabled":""}`} href="/payroll" aria-disabled={offlineMode} onClick={event=>{if(offlineMode)event.preventDefault()}}><span className="dashboard-kpi-icon gold"><Icon name="users" size={19}/></span><span className="dashboard-kpi-label">{t("ownerPulsePeople")}</span><strong>{t("ownerPulseSalary")}: {formatMoney(summary.ownerPulse.salaryPayable)}</strong><small>{t("ownerPulseAdvances")}: {formatMoney(summary.ownerPulse.employeeAdvanceBalance)} · {ownerPulseDate(summary.ownerPulse.asOfDate)}</small></a>
            </div>
          </>}
          <div className="section-heading"><div><h2>{t("modulesTitle")}</h2><p>{t("modulesIntro")}</p></div><span className="phase-tag">{t("foundationPhase")}</span></div>
          <div className="module-grid">
            {modules.map(([number, title, detail, status, ready, icon, href]) => href&&!offlineMode ? <a className="module-card module-card-link" href={href} key={number}><div className="module-card-top"><span className="module-icon-tile"><Icon name={icon} size={20}/></span><span className={ready ? "module-status ready" : "module-status"}><i/>{status}</span></div><h3>{title}</h3><p>{detail}</p></a> : <article className={`module-card${offlineMode&&href?" offline-disabled":""}`} key={number} aria-disabled={offlineMode&&href?"true":undefined}><div className="module-card-top"><span className="module-icon-tile"><Icon name={icon} size={20}/></span><span className={ready ? "module-status ready" : "module-status"}><i/>{status}</span></div><h3>{title}</h3><p>{detail}</p></article>)}
          </div>
          <footer className="dash-footer">Brick Chamber ERP <span>·</span> {t("dashboardFooter")}</footer>
        </div>
      </section>
    </main>
  );
}




