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
    invalidCredentials: "Email or password is incorrect.",
    serverUnavailable: "Unable to connect to the ERP server.",
    firstSetup: "FIRST-TIME SETUP",
    setupHeadline: "Set up your business workspace.",
    setupCopy: "Create the initial owner account. This setup page closes automatically after the first company is created.",
    setupFooter: "Private setup · Owner access · Audit ready",
    createOwnerTitle: "Create your owner account",
    workspaceCreated: "Workspace created",
    ownerAccountReady: "Your owner account is ready. Sign in to continue.",
    setupExplanation: "This creates the first company and its owner. Public sign-up closes after setup.",
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
    invalidCredentials: "மின்னஞ்சல் அல்லது கடவுச்சொல் தவறாக உள்ளது.",
    serverUnavailable: "ERP சேவையகத்துடன் இணைக்க முடியவில்லை.",
    firstSetup: "முதல் முறை அமைப்பு",
    setupHeadline: "உங்கள் வணிகப் பணியிடத்தை அமைக்கவும்.",
    setupCopy: "முதல் உரிமையாளர் கணக்கை உருவாக்கவும். முதல் நிறுவனம் உருவானதும் இந்த அமைப்புப் பக்கம் தானாக மூடப்படும்.",
    setupFooter: "தனிப்பட்ட அமைப்பு · உரிமையாளர் அணுகல் · தணிக்கைக்குத் தயார்",
    createOwnerTitle: "உரிமையாளர் கணக்கை உருவாக்கவும்",
    workspaceCreated: "பணியிடம் உருவாக்கப்பட்டது",
    ownerAccountReady: "உங்கள் உரிமையாளர் கணக்கு தயாராக உள்ளது. தொடர உள்நுழையவும்.",
    setupExplanation: "இது முதல் நிறுவனத்தையும் அதன் உரிமையாளரையும் உருவாக்கும். அமைப்புக்குப் பிறகு பொதுப் பதிவு முடக்கப்படும்.",
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

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className="language-picker">
      <span className="sr-only">{t("language")}</span>
      <Icon name="globe" size={16} />
      <select aria-label={t("language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
        <option value="en">English</option>
        <option value="ta">தமிழ்</option>
      </select>
    </label>
  );
}
