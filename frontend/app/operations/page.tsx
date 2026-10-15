"use client";

import { useEffect, useMemo, useState } from "react";
import { CompanyBrand, MobileNavigation } from "../navigation";
import { LanguageSwitcher, useLocale } from "../i18n";
import { Icon, type IconName } from "../visuals";

const API = "";
type ModuleKey = "production" | "stock" | "sales" | "loading" | "purchases" | "people" | "payroll" | "expenses" | "accounts" | "returns";
type ModuleLink = { key: ModuleKey; href: string; icon: IconName; permissions: string[] };
type LowStockItem = { productId: string; productName: string; code: string; unit: string; minimumStock: string | number; onHandQuantity: string | number; shortage: string | number };

const copy = {
  en: {
    title: "Operations", intro: "Move work from the kiln and stockyard through sales, delivery and payment.", home: "Home", approvals: "Approvals", reports: "Reports", loading: "Loading your access…", error: "Could not load your access. Try again.",
    production: "Production", productionText: "Plan batches, record kiln stages, classify output and review production cost.",
    stock: "Stock & masters", stockText: "Check stock, products, chambers, customers, suppliers and other business records.",
    sales: "Sales", salesText: "Create customer orders and invoices, record collections and manage returns.",
    loadingJobs: "Loading & delivery", loadingText: "Start loads, capture evidence, verify quantities and record delivery.",
    purchases: "Purchases", purchasesText: "Create supplier orders, receive materials, enter bills and record payments.",
    people: "People & attendance", peopleText: "Manage employee records, attendance, overtime and advances.",
    payroll: "Payroll", payrollText: "Prepare, review, approve and pay salary runs.",
    expenses: "Expenses", expensesText: "Record business expenses and follow approval status.",
    accounts: "Accounts", accountsText: "Review the chart of accounts, journals and financial records.",
    returns: "Customer stock returns", returnsText: "Receive returned bricks without creating an invoice credit. Record condition, cost and stock location.",
    open: "Open", noModules: "Your account has no operational modules assigned. Ask the Owner to review your role.", lowTitle: "Low-stock alert", lowHelp: "Products below their configured minimum in the selected branch scope.", lowEmpty: "No products are below their minimum stock level.", lowError: "Low-stock details could not be loaded.", minimum: "Minimum", onHand: "Available", viewStock: "Review products",
  },
  ta: {
    title: "செயல்பாடுகள்", intro: "சூளை மற்றும் சரக்கிலிருந்து விற்பனை, விநியோகம், பணம் வசூல் வரை பணிகளைச் செய்யுங்கள்.", home: "முகப்பு", approvals: "ஒப்புதல்கள்", reports: "அறிக்கைகள்", loading: "உங்கள் அணுகல் ஏற்றப்படுகிறது…", error: "உங்கள் அணுகலை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
    production: "உற்பத்தி", productionText: "தொகுதிகளைத் திட்டமிட்டு, சூளை நிலைகளைப் பதிவு செய்து, உற்பத்தி மற்றும் செலவைப் பாருங்கள்.",
    stock: "சரக்கு மற்றும் அடிப்படைத் தகவல்கள்", stockText: "சரக்கு, தயாரிப்புகள், சூளைகள், வாடிக்கையாளர்கள், வழங்குநர்கள் மற்றும் வணிகப் பதிவுகளைப் பாருங்கள்.",
    sales: "விற்பனை", salesText: "வாடிக்கையாளர் ஆணை, விலைப்பட்டியல், வசூல் மற்றும் திரும்பப் பெறுதலை நிர்வகிக்கவும்.",
    loadingJobs: "ஏற்றுதல் மற்றும் விநியோகம்", loadingText: "சரக்கேற்றத்தைத் தொடங்கி, படங்களைப் பதிவு செய்து, அளவைச் சரிபார்த்து விநியோகத்தைப் பதிவு செய்யவும்.",
    purchases: "கொள்முதல்", purchasesText: "வழங்குநர் ஆணை, சரக்கு வரவு, பில் மற்றும் பணம் செலுத்துதலை நிர்வகிக்கவும்.",
    people: "பணியாளர் மற்றும் வருகை", peopleText: "பணியாளர் விவரம், வருகை, கூடுதல் நேரம் மற்றும் முன்பணத்தை நிர்வகிக்கவும்.",
    payroll: "சம்பளம்", payrollText: "சம்பளப் பட்டியலைத் தயாரித்து, பரிசீலித்து, ஒப்புதல் பெற்று, செலுத்தவும்.",
    expenses: "செலவுகள்", expensesText: "வணிகச் செலவுகளைப் பதிவு செய்து ஒப்புதல் நிலையைப் பாருங்கள்.",
    accounts: "கணக்குகள்", accountsText: "கணக்குப் பட்டியல், ஜர்னல் மற்றும் நிதிப் பதிவுகளைப் பாருங்கள்.",
    returns: "வாடிக்கையாளர் சரக்கு திரும்பப் பெறல்", returnsText: "விலைப்பட்டியல் கடன் குறிப்பு இல்லாமல் திரும்பிய செங்கற்களைப் பெறுங்கள். நிலை, செலவு மற்றும் இருப்பிடத்தைப் பதிவு செய்யுங்கள்.",
    open: "திறக்கவும்", noModules: "உங்கள் கணக்கிற்கு செயல்பாட்டு அணுகல் ஒதுக்கப்படவில்லை. உரிமையாளரிடம் உங்கள் பங்கைச் சரிபார்க்கச் சொல்லவும்.", lowTitle: "குறைந்த சரக்கு எச்சரிக்கை", lowHelp: "தேர்ந்தெடுத்த கிளை வரம்பில் குறைந்தபட்ச அளவை விட குறைவான பொருட்கள்.", lowEmpty: "எந்தப் பொருளின் சரக்கும் குறைந்தபட்ச அளவை விடக் குறைவாக இல்லை.", lowError: "குறைந்த சரக்கு விவரங்களை ஏற்ற முடியவில்லை.", minimum: "குறைந்தபட்சம்", onHand: "கையிருப்பு", viewStock: "பொருட்களைப் பார்க்க",
  },
} as const;

const moduleLinks: ModuleLink[] = [
  { key: "production", href: "/production", icon: "factory", permissions: ["production.view", "production.create"] },
  { key: "stock", href: "/masters", icon: "boxes", permissions: ["stock.view", "masters.view"] },
  { key: "sales", href: "/sales", icon: "receipt", permissions: ["sales.view", "sales.create"] },
  { key: "loading", href: "/loading", icon: "truck", permissions: ["loading.view", "loading.create"] },
  { key: "purchases", href: "/purchases", icon: "shopping", permissions: ["purchases.view", "purchases.create"] },
  { key: "people", href: "/people", icon: "users", permissions: ["employees.view", "attendance.view", "attendance.record"] },
  { key: "payroll", href: "/payroll", icon: "cash", permissions: ["payroll.view", "payroll.run.create"] },
  { key: "expenses", href: "/expenses", icon: "calculator", permissions: ["expenses.view", "expenses.create"] },
  { key: "accounts", href: "/accounting/accounts", icon: "chart", permissions: ["accounting.view"] },
  { key: "returns", href: "/stock-returns", icon: "receipt", permissions: ["stock.return.create"] },
];

export default function OperationsPage() {
  const { locale } = useLocale();
  const w = copy[locale];
  const [permissions, setPermissions] = useState<string[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lowStockError, setLowStockError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const token = sessionStorage.getItem("brick-erp-session");
    if (!token) { window.location.replace("/"); return; }
    void fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) { window.location.replace("/"); return null; }
        if (!response.ok) throw new Error("profile unavailable");
        return response.json();
      })
      .then((data) => {
        if (!live || !data?.user) return;
        const allowed = (data.user.permissions ?? []) as string[];
        setPermissions(allowed);
        if (allowed.includes("stock.view")) {
          void fetch(API + "/api/inventory/low-stock", { headers: { Authorization: "Bearer " + token }, cache: "no-store" })
            .then(async (response) => { if (!response.ok) throw new Error("low stock unavailable"); return response.json(); })
            .then((result) => { if (live) setLowStock(result.products ?? []); })
            .catch(() => { if (live) setLowStockError(true); });
        }
      })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const visibleModules = useMemo(() => moduleLinks.filter((module) => module.permissions.some((permission) => permissions.includes(permission))), [permissions]);
  const heading = (key: ModuleKey) => key === "loading" ? w.loadingJobs : w[key];
  const description = (key: ModuleKey) => key === "loading" ? w.loadingText : w[`${key}Text` as keyof typeof w];

  return <main className="dashboard-shell">
    <aside className="sidebar">
      <CompanyBrand href="/dashboard" />
      <div className="nav-label">{w.title.toUpperCase()}</div>
      <a className="nav-item" href="/dashboard"><Icon name="home" size={17} />{w.home}</a>
      <a className="nav-item active" href="/operations"><Icon name="boxes" size={17} />{w.title}</a>
      <a className="nav-item" href="/approvals"><Icon name="check" size={17} />{w.approvals}</a>
      <a className="nav-item" href="/reports"><Icon name="chart" size={17} />{w.reports}</a>
    </aside>
    <MobileNavigation active="operations" />
    <section className="dashboard-main">
      <header className="topbar"><div className="breadcrumb"><a href="/dashboard">{w.home}</a><span>/</span>{w.title}</div><div className="topbar-right"><LanguageSwitcher /></div></header>
      <div className="dashboard-content operations-content">
        <div className="operations-heading"><div><div className="eyebrow muted">BRICK CHAMBER ERP</div><h1>{w.title}</h1><p>{w.intro}</p></div><span className="module-icon-tile"><Icon name="factory" size={22} /></span></div>
        {error && <div className="master-alert error" role="alert"><Icon name="alert" size={17} />{w.error}</div>}
        {!loading && permissions.includes("stock.view") && <section className="operations-low-stock" aria-labelledby="low-stock-title">
          <div className="operations-low-stock-heading"><span className="operations-low-stock-icon"><Icon name="alert" size={20} /></span><div><h2 id="low-stock-title">{w.lowTitle}{lowStock.length > 0 && <span className="operations-low-stock-count">{lowStock.length}</span>}</h2><p>{w.lowHelp}</p></div><a href="/masters?kind=products">{w.viewStock}<Icon name="arrowRight" size={16} /></a></div>
          {lowStockError ? <p className="operations-low-stock-empty" role="status">{w.lowError}</p> : lowStock.length ? <div className="operations-low-stock-list">{lowStock.slice(0, 5).map((item) => <div className="operations-low-stock-row" key={item.productId}><div><b>{item.productName}</b><small>{item.code}</small></div><span>{w.onHand}: <b>{Number(item.onHandQuantity).toLocaleString(locale === "ta" ? "ta-IN" : "en-IN")} {item.unit}</b></span><span>{w.minimum}: {Number(item.minimumStock).toLocaleString(locale === "ta" ? "ta-IN" : "en-IN")} {item.unit}</span></div>)}</div> : <p className="operations-low-stock-empty"><Icon name="check" size={16} />{w.lowEmpty}</p>}
        </section>}
        {loading ? <div className="master-empty" role="status">{w.loading}</div> : visibleModules.length ? <div className="operations-grid">{visibleModules.map((module) => <a className="operations-card" href={module.href} key={module.key}><span className="operations-card-icon"><Icon name={module.icon} size={22} /></span><span className="operations-card-copy"><b>{heading(module.key)}</b><small>{description(module.key)}</small></span><span className="operations-card-open"><Icon name="arrowRight" size={17} /><span>{w.open}</span></span></a>)}</div> : <div className="master-empty">{w.noModules}</div>}
        <footer className="dash-footer">Brick Chamber ERP <span>·</span> {w.title}</footer>
      </div>
    </section>
  </main>;
}
