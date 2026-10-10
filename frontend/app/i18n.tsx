"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./visuals";

export type Locale = "en" | "ta";

const messages = {
  en: {
    language: "Language",
    brand: "BRICK CHAMBER ERP",
    loginHeadline: "One clear view of your business.",
    loginCopy: "Production, stock, sales and finance, connected from the chamber to the ledger.",
    loginFooter: "Operations · Accounting · Audit",
    welcomeBack: "WELCOME BACK",
    signInTitle: "Sign in to your workspace",
    signInHelp: "Use the account provided by your ERP administrator.",
    email: "Email address",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    secureAccess: "Secure, role-based access",
    firstTimeQuestion: "Setting up for the first time?",
    createOwnerLink: "Create the owner account",
    signInFailed: "Sign-in failed.",
    databaseUnavailable: "The database is unavailable. Start PostgreSQL, confirm the API is running, then retry.",
    setupDuplicate: "That email or another unique value is already in use. Check the email address or sign in to the existing account.",
    migrationsRequired: "The database schema needs an update. Run npm run db:migrate, then restart the API.",
    databaseConflict: "This request conflicts with existing database records. Refresh the page and retry.",
    invalidCredentials: "Email or password is incorrect.",
    serverUnavailable: "Unable to connect to the ERP server.",
    firstSetup: "FIRST-TIME SETUP",
    setupHeadline: "Set up your business workspace.",
    setupCopy: "Create your company and the first Owner login. After sign-in, the Owner can set the company logo and add Manager or Cashier accounts.",
    setupFooter: "Private setup · Owner access · Audit ready",
    createOwnerTitle: "Create your owner account",
    workspaceCreated: "Workspace created",
    ownerAccountReady: "Your company and Owner account are ready. Sign in as Owner to add Manager or Cashier accounts and set the company logo.",
    setupExplanation: "This one-time step creates the company and its Owner account. The Owner can later add Manager and Cashier logins and change the company name or logo. Public sign-up stays closed.",
    setupRolesNote: "First create the Owner login here. After signing in, use User access to add Manager or Cashier accounts; use Company profile to change the company name or logo.",
    companyName: "Company name",
    ownerName: "Owner name",
    confirmPassword: "Confirm password",
    passwordMinimum: "12 characters minimum",
    creatingWorkspace: "Creating workspace…",
    createOwner: "Create owner account",
    goToSignIn: "Go to sign in",
    setupUnavailable: "First-time setup is unavailable. Start the API and database, then reload this page.",
    passwordMismatch: "The passwords do not match.",
    setupFailed: "Setup could not be completed.",
    serverCouldNotBeReached: "The ERP server could not be reached.",
    setupAlreadyComplete: "Initial setup is already complete. Ask your ERP administrator to create your account.",
    backToSignIn: "Back to sign in",
    loadingWorkspace: "Loading your workspace…",
    workspace: "Workspace",
    overview: "Overview",
    operations: "OPERATIONS",
    production: "Production",
    stock: "Stock",
    salesLoading: "Sales & loading",
    labour: "Labour",
    purchasesExpenses: "Purchases & expenses",
    expenses: "Expenses",
    reports: "Financial reports",
    planned: "Planned",
    systemConnected: "System connected",
    businessOverview: "BUSINESS OVERVIEW",
    welcomeGreeting: "Good to have you here, {name}.",
    dashboardIntro: "Your ERP foundation is ready. Operational modules will appear here as they are configured.",
    dashboardKpis: "Business at a glance",
    dashboardPeriod: "Sales, collections, expenses & production use this range. Stock and receivables are current.",
    fromDate: "From",
    toDate: "To",
    dashboardSales: "Sales invoiced",
    dashboardCollections: "Collections received",
    dashboardExpenses: "Expenses posted",
    dashboardReceivables: "Customer receivables",
    dashboardStock: "Stock on hand",
    dashboardStockProducts: "products",
    dashboardProducts: "products",
    dashboardMixedUnits: "Output totals use different units",
    dashboardStockValue: "FIFO value",
    dashboardUnvalued: "Unvalued stock",
    dashboardProduction: "Saleable production",
    dashboardBatches: "Completed batches",
    dashboardChambers: "Active chambers",
    dashboardAvailable: "Available",
    dashboardPending: "Pending approvals",
    dashboardLoading: "Loading business summary…",
    dashboardSummaryError: "Business summary is temporarily unavailable.",
    offlineLabel: "Offline",
    offlineCachedTitle: "Offline · read-only workspace",
    offlineCachedCopy: "Saved {time}. This view is read-only and may be out of date.",
    offlineNoSummary: "Offline; no saved summary is available for this date range. Reconnect to load it.",
    offlineProfileUnavailable: "Connect to the internet to sign in and load this workspace.",
    dashboardNoApprovalAccess: "Approval count hidden for your role",
    workspaceReady: "Your workspace is set up",
    workspaceReadyCopy: "Company access, secure sign-in, roles and audit foundations are active.",
    modulesTitle: "ERP modules",
    modulesIntro: "Modules become available as their workflows are implemented.",
    foundationPhase: "FOUNDATION PHASE",
    administration: "Administration",
    administrationDetail: "Company, branches, users and access controls",
    productionDetail: "Chamber batches, quality output and stock posting",
    inventory: "Inventory",
    inventoryDetail: "Stock ledger, locations and controlled adjustments",
    salesBilling: "Sales & billing",
    salesBillingDetail: "Orders, invoices, collections and customer ledger",
    loadingDelivery: "Loading & delivery",
    loadingDeliveryDetail: "Loading evidence, verification and dispatch",
    purchasesDetail: "Material orders, supplier bills, payments and balances",
    expensesDetail: "Record operating costs and track cash and bank payments",
    reportsDetail: "Review trial balance and profit and loss from posted journals",
    accounting: "Accounting",
    accountingDetail: "Journals, cash, bank and financial reports",
    ready: "Ready",
    inRoadmap: "In roadmap",
    ownerRole: "Owner",
    teamMember: "Team member",
    signOut: "Sign out",
    dashboardFooter: "Secure operations workspace",
  },
  ta: {
    language: "மொழி",
    brand: "BRICK CHAMBER ERP",
    loginHeadline: "உங்கள் வணிகத்தை ஒரே பார்வையில் காணுங்கள்.",
    loginCopy: "உற்பத்தி, சரக்கு, விற்பனை மற்றும் நிதி விவரங்களை உற்பத்தி அறையிலிருந்து கணக்குப் பதிவேடு வரை இணைக்கிறது.",
    loginFooter: "செயல்பாடுகள் · கணக்கியல் · தணிக்கை",
    welcomeBack: "மீண்டும் வரவேற்கிறோம்",
    signInTitle: "உங்கள் பணியிடத்தில் உள்நுழையுங்கள்",
    signInHelp: "உங்கள் ERP நிர்வாகி வழங்கிய கணக்கைப் பயன்படுத்தவும்.",
    email: "மின்னஞ்சல் முகவரி",
    password: "கடவுச்சொல்",
    signIn: "உள்நுழை",
    signingIn: "உள்நுழைகிறது…",
    secureAccess: "பாதுகாப்பான, பொறுப்பு அடிப்படையிலான அணுகல்",
    firstTimeQuestion: "முதல் முறையாக அமைக்கிறீர்களா?",
    createOwnerLink: "நிறுவன உரிமையாளர் கணக்கை உருவாக்கவும்",
    signInFailed: "உள்நுழைய முடியவில்லை.",
    databaseUnavailable: "தரவுத்தளத்தை அணுக முடியவில்லை. PostgreSQL மற்றும் API இயங்குவதை உறுதிசெய்து மீண்டும் முயற்சிக்கவும்.",
    setupDuplicate: "இந்த மின்னஞ்சல் அல்லது தனிப்பட்ட மதிப்பு ஏற்கனவே பயன்பாட்டில் உள்ளது. மின்னஞ்சலைச் சரிபார்க்கவும் அல்லது உள்ள கணக்கில் உள்நுழையவும்.",
    migrationsRequired: "தரவுத்தள அமைப்பைப் புதுப்பிக்க வேண்டும். npm run db:migrate இயக்கி API-ஐ மீண்டும் தொடங்கவும்.",
    databaseConflict: "இந்த கோரிக்கை ஏற்கனவே உள்ள தரவுகளுடன் முரண்படுகிறது. பக்கத்தைப் புதுப்பித்து மீண்டும் முயற்சிக்கவும்.",
    invalidCredentials: "மின்னஞ்சல் அல்லது கடவுச்சொல் தவறாக உள்ளது.",
    serverUnavailable: "ERP சேவையகத்துடன் இணைக்க முடியவில்லை.",
    firstSetup: "முதல் முறை அமைப்பு",
    setupHeadline: "உங்கள் வணிகப் பணியிடத்தை அமைக்கவும்.",
    setupCopy: "உங்கள் நிறுவனத்தையும் முதல் உரிமையாளர் உள்நுழைவையும் உருவாக்குங்கள். உள்நுழைந்த பிறகு, நிறுவன உரிமையாளர் லோகோவை அமைத்து மேலாளர் அல்லது காசாளர் கணக்குகளைச் சேர்க்கலாம்.",
    setupFooter: "தனிப்பட்ட அமைப்பு · உரிமையாளர் அணுகல் · தணிக்கைக்குத் தயார்",
    createOwnerTitle: "உரிமையாளர் கணக்கை உருவாக்கவும்",
    workspaceCreated: "பணியிடம் உருவாக்கப்பட்டது",
    ownerAccountReady: "உங்கள் நிறுவனமும் உரிமையாளர் கணக்கும் தயாராக உள்ளன. மேலாளர் அல்லது காசாளர் கணக்குகளைச் சேர்க்கவும் நிறுவன லோகோவை அமைக்கவும் உரிமையாளராக உள்நுழையுங்கள்.",
    setupExplanation: "இந்த ஒருமுறை படி நிறுவனத்தையும் உரிமையாளர் கணக்கையும் உருவாக்கும். பின்னர் உரிமையாளர் மேலாளர் மற்றும் காசாளர் உள்நுழைவுகளைச் சேர்த்து நிறுவனப் பெயர் அல்லது லோகோவை மாற்றலாம். பொதுப் பதிவு தொடர்ந்து மூடப்பட்டிருக்கும்.",
    setupRolesNote: "முதலில் இங்கே உரிமையாளர் உள்நுழைவை உருவாக்கவும். உள்நுழைந்த பிறகு பயனர் அணுகல் பகுதியில் மேலாளர் அல்லது காசாளர் கணக்குகளைச் சேர்க்கவும்; நிறுவன விவரத்தில் பெயர் அல்லது லோகோவை மாற்றவும்.",
    companyName: "நிறுவனத்தின் பெயர்",
    ownerName: "உரிமையாளர் பெயர்",
    confirmPassword: "கடவுச்சொல்லை உறுதிப்படுத்தவும்",
    passwordMinimum: "குறைந்தது 12 எழுத்துகள்",
    creatingWorkspace: "பணியிடம் உருவாக்கப்படுகிறது…",
    createOwner: "உரிமையாளர் கணக்கை உருவாக்கவும்",
    goToSignIn: "உள்நுழைவுக்குச் செல்லவும்",
    setupUnavailable: "முதல் முறை அமைப்பு தற்போது கிடைக்கவில்லை. API மற்றும் தரவுத்தளத்தைத் தொடங்கி, இந்தப் பக்கத்தை மீண்டும் ஏற்றவும்.",
    passwordMismatch: "இரண்டு கடவுச்சொற்களும் பொருந்தவில்லை.",
    setupFailed: "அமைப்பை முடிக்க முடியவில்லை.",
    serverCouldNotBeReached: "ERP சேவையகத்தை அணுக முடியவில்லை.",
    setupAlreadyComplete: "ஆரம்ப அமைப்பு ஏற்கனவே முடிந்துவிட்டது. கணக்கு உருவாக்க ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.",
    backToSignIn: "உள்நுழைவுக்குத் திரும்பவும்",
    loadingWorkspace: "உங்கள் பணியிடம் ஏற்றப்படுகிறது…",
    workspace: "பணியிடம்",
    overview: "கண்ணோட்டம்",
    operations: "செயல்பாடுகள்",
    production: "உற்பத்தி",
    stock: "சரக்கு",
    salesLoading: "விற்பனை மற்றும் ஏற்றுதல்",
    labour: "தொழிலாளர் மேலாண்மை",
    purchasesExpenses: "கொள்முதல் மற்றும் செலவுகள்",
    expenses: "செலவுகள்",
    reports: "நிதி அறிக்கைகள்",
    planned: "திட்டமிடப்பட்டுள்ளது",
    systemConnected: "அமைப்பு இணைக்கப்பட்டுள்ளது",
    businessOverview: "வணிகக் கண்ணோட்டம்",
    welcomeGreeting: "வரவேற்கிறோம், {name}.",
    dashboardIntro: "உங்கள் ERP அடிப்படை அமைப்பு தயாராக உள்ளது. செயல்பாட்டு பகுதிகள் அமைக்கப்பட்டதும் இங்கே தோன்றும்.",
    dashboardKpis: "வணிகச் சுருக்கம்",
    dashboardPeriod: "விற்பனை, வசூல், செலவுகள் மற்றும் உற்பத்தி இந்த காலத்தைப் பயன்படுத்தும். சரக்கு மற்றும் வரவேண்டிய தொகை தற்போதையவை.",
    fromDate: "தொடக்கம்",
    toDate: "முடிவு",
    dashboardSales: "விலைப்பட்டியல் விற்பனை",
    dashboardCollections: "பெற்ற வசூல்",
    dashboardExpenses: "பதிவான செலவுகள்",
    dashboardReceivables: "வாடிக்கையாளர் வரவேண்டியது",
    dashboardStock: "கையிருப்பு",
    dashboardStockProducts: "பொருட்கள்",
    dashboardProducts: "பொருட்கள்",
    dashboardMixedUnits: "உற்பத்தி அளவுகள் வேறு அலகுகளில் உள்ளன",
    dashboardStockValue: "FIFO மதிப்பு",
    dashboardUnvalued: "மதிப்பிடாத சரக்கு",
    dashboardProduction: "விற்பனைக்குத் தகுந்த உற்பத்தி",
    dashboardBatches: "முடிக்கப்பட்ட தொகுதிகள்",
    dashboardChambers: "செயலில் உள்ள சூளைகள்",
    dashboardAvailable: "கிடைக்கிறது",
    dashboardPending: "நிலுவை ஒப்புதல்கள்",
    dashboardLoading: "வணிகச் சுருக்கம் ஏற்றப்படுகிறது…",
    dashboardSummaryError: "வணிகச் சுருக்கத்தை இப்போது பெற முடியவில்லை.",
    offlineLabel: "இணையமில்லை",
    offlineCachedTitle: "இணையமில்லை · வாசிக்க மட்டும்",
    offlineCachedCopy: "{time} அன்று சேமிக்கப்பட்டது. இது வாசிக்க மட்டும்; தகவல் பழையதாக இருக்கலாம்.",
    offlineNoSummary: "இணையமில்லை; இந்த தேதி வரம்பிற்கான சுருக்கம் சேமிக்கப்படவில்லை. மீண்டும் இணைத்து ஏற்றவும்.",
    offlineProfileUnavailable: "உள்நுழைந்து பணியிடத்தை ஏற்ற இணையத்துடன் இணைக்கவும்.",
    dashboardNoApprovalAccess: "உங்கள் பொறுப்பிற்கு ஒப்புதல் எண்ணிக்கை காட்டப்படாது",
    workspaceReady: "உங்கள் பணியிடம் அமைக்கப்பட்டது",
    workspaceReadyCopy: "நிறுவன அணுகல், பாதுகாப்பான உள்நுழைவு, பொறுப்புகள் மற்றும் தணிக்கை அடிப்படை அம்சங்கள் செயல்பாட்டில் உள்ளன.",
    modulesTitle: "ERP பிரிவுகள்",
    modulesIntro: "செயல்முறைகள் உருவாக்கப்படும் போது பிரிவுகள் பயன்பாட்டுக்கு வரும்.",
    foundationPhase: "அடிப்படை கட்டம்",
    administration: "நிர்வாகம்",
    administrationDetail: "நிறுவனம், கிளைகள், பயனர்கள் மற்றும் அணுகல் கட்டுப்பாடுகள்",
    productionDetail: "சூளைத் தொகுதிகள், தரவாரியான உற்பத்தி மற்றும் சரக்கு பதிவு",
    inventory: "சரக்கு மேலாண்மை",
    inventoryDetail: "சரக்கு பதிவேடு, இருப்பிடங்கள் மற்றும் கட்டுப்படுத்தப்பட்ட சரிசெய்தல்கள்",
    salesBilling: "விற்பனை மற்றும் பட்டியல்",
    salesBillingDetail: "ஆர்டர்கள், விலைப்பட்டியல்கள், வசூல்கள் மற்றும் வாடிக்கையாளர் கணக்கு",
    loadingDelivery: "ஏற்றுதல் மற்றும் விநியோகம்",
    loadingDeliveryDetail: "ஏற்றுதல் சான்று, சரிபார்ப்பு மற்றும் அனுப்புதல்",
    purchasesDetail: "பொருள் ஆர்டர்கள், வழங்குநர் பில்கள், பணம் மற்றும் நிலுவைகள்",
    expensesDetail: "செயல்பாட்டுச் செலவுகளைப் பதிவு செய்து ரொக்கம் மற்றும் வங்கியைக் கண்காணிக்கவும்",
    reportsDetail: "பதிவான கணக்குகளிலிருந்து சோதனை இருப்பு மற்றும் லாப நஷ்ட அறிக்கையைப் பாருங்கள்",
    accounting: "கணக்கியல்",
    accountingDetail: "கணக்குப் பதிவுகள், ரொக்கம், வங்கி மற்றும் நிதி அறிக்கைகள்",
    ready: "தயார்",
    inRoadmap: "திட்டத்தில் உள்ளது",
    ownerRole: "உரிமையாளர்",
    teamMember: "குழு உறுப்பினர்",
    signOut: "வெளியேறு",
    dashboardFooter: "பாதுகாப்பான செயல்பாட்டு பணியிடம்",
  },
} as const;

export type TranslationKey = keyof typeof messages.en;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = "brick-erp-language";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ta") setLocale(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.lang = locale === "ta" ? "ta" : "en";
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [hydrated, locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => messages[locale][key],
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}

function BranchSwitcher() {
  const { locale } = useLocale();
  const [branches,setBranches]=useState<Array<{id:string;code:string;name:string}>>([]);
  const [current,setCurrent]=useState<string|null>(null);
  const [canViewAll,setCanViewAll]=useState(false);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{const token=sessionStorage.getItem("brick-erp-session");if(!token)return;void fetch(`${process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000"}/api/auth/branches`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(d?.branches){setBranches(d.branches);setCurrent(d.currentBranchId??null);setCanViewAll(Boolean(d.canViewAll))}}).catch(()=>undefined)},[]);
  async function change(branchId:string){const token=sessionStorage.getItem("brick-erp-session");if(!token)return;setSaving(true);try{const r=await fetch(`${process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000"}/api/auth/branch`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({branchId:branchId||null})});if(r.ok)window.location.reload()}finally{setSaving(false)}}
  if(!branches.length)return null;
  return <label className="branch-picker"><Icon name="building" size={16}/><span className="sr-only">{locale==="ta"?"கிளை":"Branch"}</span><select aria-label={locale==="ta"?"கிளை":"Branch"} value={current??""} disabled={saving} onChange={event=>void change(event.target.value)}><option value="" disabled={!canViewAll}>{canViewAll?(locale==="ta"?"அனைத்து கிளைகள்":"All branches"):(locale==="ta"?"கிளையைத் தேர்ந்தெடுக்கவும்":"Choose branch")}</option>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <>
      <BranchSwitcher />
      <label className="language-picker">
        <span className="sr-only">{t("language")}</span>
        <Icon name="globe" size={16} />
        <select aria-label={t("language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
          <option value="en">English</option>
          <option value="ta">தமிழ்</option>
        </select>
      </label>
    </>
  );
}
