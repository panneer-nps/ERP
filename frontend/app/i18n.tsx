"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./visuals";

export type Locale = "en" | "ta";

const messages = {
  en: {
    language: "Language",
    englishLanguage: "English",
    brand: "BRICK CHAMBER ERP",
    loginHeadline: "One clear view of your business.",
    loginCopy: "Production, stock, sales and finance, connected from the chamber to the ledger.",
    loginFooter: "Operations · Accounting · Audit",
    welcomeBack: "WELCOME BACK",
    signInTitle: "Sign in to your workspace",
    signInHelp: "The Owner and all staff use this same sign-in. Your assigned role sets what you can access.",
    email: "Email address",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signIn: "Sign in",
    authenticatorCode: "Authenticator code",
    authenticatorHelp: "Enter a fresh six-digit code from your authenticator app. The code used during setup cannot be reused. You can use a recovery code if needed.",
    verifyAndSignIn: "Verify and sign in",
    differentAccount: "Use a different account",
    signingIn: "Signing in…",
    secureAccess: "Secure, role-based access",
    firstTimeQuestion: "Setting up for the first time?",
    createOwnerLink: "Create the owner account",
    signInFailed: "Sign-in failed.",
    checkFormDetails: "Check the entered details and try again.",
    permissionDenied: "You do not have permission to complete this action. Contact your ERP administrator.",
    duplicateValue: "This value is already in use. Check the record and try again.",
    databaseUnavailable: "The database is unavailable. Start PostgreSQL, confirm the API is running, then retry.",
    databaseConfiguration: "The API reached PostgreSQL, but the database name or login was rejected. Ask the ERP administrator to check backend/.env; do not share the database password.",
    serverRequestFailed: "The server could not complete this request. Check the API log using the reference below.",
    errorReference: "Reference ID",
    setupDuplicate: "That email or another unique value is already in use. Check the email address or sign in to the existing account.",
    migrationsRequired: "The database schema needs an update. Follow the steps below, then reload this page.",
    migrationHelpTitle: "Show the Windows setup steps",
    migrationBackup: "Back up the company database before applying schema changes.",
    migrationRunFrom: "Open PowerShell in the ERP project folder and check the schema status:",
    migrationApply: "If migrations are pending, confirm the backup and then apply them:",
    migrationRestart: "After migration finishes, stop the API with Ctrl+C, then start it again:",
    databaseConflict: "This request conflicts with existing database records. Refresh the page and retry.",
    invalidCredentials: "Email or password is incorrect.",
    invalidSecondFactor: "That authenticator or recovery code is incorrect. Try again.",
    serverUnavailable: "Unable to connect to the ERP server.",
    firstSetup: "FIRST-TIME SETUP",
    setupHeadline: "Set up your business workspace.",
    setupCopy: "Create the company and its first Owner login. After sign-in, update the company profile, add any branches, and create Manager or Cashier staff logins.",
    setupFooter: "Private setup · Owner access · Audit ready",
    createOwnerTitle: "Create your owner account",
    workspaceCreated: "Workspace created",
    ownerAccountReady: "Your company and Owner login are ready. Sign in as Owner to update the company name/logo, create branches if needed, and add Manager or Cashier logins.",
    setupExplanation: "Create only the first Owner login here. After sign-in, update the company name/logo in Company profile. In User access, create branches first if needed, then add Manager or Cashier accounts with their own passwords. Everyone uses the same sign-in page; public sign-up stays closed.",
    setupRolesNote: "First create one Owner login here. Then update the company name/logo, create branches if needed, and add separate Manager/Cashier logins in User access. Staff do not self-sign-up.",
    setupOwnerLogin: "Owner sign-in email",
    setupAfterLoginTitle: "After signing in as Owner",
    setupStepCompany: "Open Company profile to update the display name and upload your company logo.",
    setupStepUsers: "Open User access. Add branches first if needed, then create separate Manager or Cashier logins with their own role, branch access and initial password.",
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
    dashboardIntro: "Manage production, stock, sales, delivery, purchases, people and accounts from this workspace.",
    dashboardKpis: "Business at a glance",
    dashboardPeriod: "Sales, collections, expenses & production use this range. Stock and receivables are current.",
    fromDate: "From",
    toDate: "To",
    applyDateRange: "Apply dates",
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
    ownerPulseTitle: "Owner control room",
    ownerPulseAsOf: "Balances as of {date} · {scope}",
    ownerPulseRange: "Activity from {from} to {to}",
    ownerPulseBalanceAsOf: "Balance as of {date}",
    ownerPulseOpenAsOf: "Still open by {date}",
    ownerPulseCompany: "All branches",
    ownerPulseBranch: "Selected branch",
    ownerPulseSupplier: "Supplier payable",
    ownerPulseCashBank: "Cash & bank",
    ownerPulseCash: "Cash",
    negativeCashTitle: "Cash balance is negative",
    negativeCashCopy: "Review cash entries and the opening balance. This notice does not change any records.",
    negativeCashLink: "Review cash and bank book",
    ownerPulseBank: "Bank",
    ownerPulseLoading: "Loading & delivery",
    ownerPulseOpenLoadings: "Open loadings",
    ownerPulseMismatches: "Quantity mismatches",
    ownerPulseBroker: "Broker commission payable",
    ownerPulsePeople: "Staff balances",
    ownerPulseAdvances: "Employee advances",
    ownerPulseSalary: "Salary payable",
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
    modulesIntro: "Open a Ready module to enter or review business records. Planned modules are marked.",
    foundationPhase: "CURRENT + PLANNED",
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
    englishLanguage: "ஆங்கிலம்",
    brand: "BRICK CHAMBER ERP",
    loginHeadline: "உங்கள் வணிகத்தை ஒரே பார்வையில் காணுங்கள்.",
    loginCopy: "உற்பத்தி, சரக்கு, விற்பனை மற்றும் நிதி விவரங்களை உற்பத்தி அறையிலிருந்து கணக்குப் பதிவேடு வரை இணைக்கிறது.",
    loginFooter: "செயல்பாடுகள் · கணக்கியல் · தணிக்கை",
    welcomeBack: "மீண்டும் வரவேற்கிறோம்",
    signInTitle: "உங்கள் பணியிடத்தில் உள்நுழையுங்கள்",
    signInHelp: "உரிமையாளரும் அனைத்து பணியாளர்களும் இதே உள்நுழைவைப் பயன்படுத்துவார்கள். ஒதுக்கப்பட்ட பங்கு அணுகலைத் தீர்மானிக்கும்.",
    email: "மின்னஞ்சல் முகவரி",
    password: "கடவுச்சொல்",
    showPassword: "கடவுச்சொல்லைக் காட்டு",
    hidePassword: "கடவுச்சொல்லை மறை",
    signIn: "உள்நுழை",
    authenticatorCode: "அங்கீகாரச் செயலிக் குறியீடு",
    authenticatorHelp: "அங்கீகாரச் செயலியில் புதிய ஆறு இலக்கக் குறியீட்டை உள்ளிடவும். அமைப்பின்போது பயன்படுத்திய குறியீட்டை மீண்டும் பயன்படுத்த முடியாது. தேவைப்பட்டால் மீட்புக் குறியீட்டைப் பயன்படுத்தலாம்.",
    verifyAndSignIn: "சரிபார்த்து உள்நுழை",
    differentAccount: "வேறு கணக்கைப் பயன்படுத்தவும்",
    signingIn: "உள்நுழைகிறது…",
    secureAccess: "பாதுகாப்பான, பொறுப்பு அடிப்படையிலான அணுகல்",
    firstTimeQuestion: "முதல் முறையாக அமைக்கிறீர்களா?",
    createOwnerLink: "நிறுவன உரிமையாளர் கணக்கை உருவாக்கவும்",
    signInFailed: "உள்நுழைய முடியவில்லை.",
    checkFormDetails: "உள்ளிட்ட விவரங்களைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
    permissionDenied: "இந்தச் செயலைச் செய்ய உங்களுக்கு அனுமதி இல்லை. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.",
    duplicateValue: "இந்த மதிப்பு ஏற்கனவே பயன்பாட்டில் உள்ளது. பதிவைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
    databaseUnavailable: "தரவுத்தளத்தை அணுக முடியவில்லை. PostgreSQL மற்றும் API இயங்குவதை உறுதிசெய்து மீண்டும் முயற்சிக்கவும்.",
    databaseConfiguration: "API PostgreSQL-ஐ அடைந்தது; ஆனால் தரவுத்தளப் பெயர் அல்லது உள்நுழைவு ஏற்கப்படவில்லை. backend/.env அமைப்பை ERP நிர்வாகி சரிபார்க்கட்டும்; தரவுத்தளக் கடவுச்சொல்லைப் பகிர வேண்டாம்.",
    serverRequestFailed: "சேவையகம் இந்த கோரிக்கையை முடிக்கவில்லை. கீழேயுள்ள குறிப்பெண்ணை API பதிவுகளில் பார்க்கவும்.",
    errorReference: "குறிப்பு எண்",
    setupDuplicate: "இந்த மின்னஞ்சல் அல்லது தனிப்பட்ட மதிப்பு ஏற்கனவே பயன்பாட்டில் உள்ளது. மின்னஞ்சலைச் சரிபார்க்கவும் அல்லது உள்ள கணக்கில் உள்நுழையவும்.",
    migrationsRequired: "தரவுத்தள அமைப்பைப் புதுப்பிக்க வேண்டும். கீழே உள்ள படிகளைப் பின்பற்றி இந்தப் பக்கத்தை மீண்டும் ஏற்றவும்.",
    migrationHelpTitle: "Windows அமைப்பு வழிமுறைகளைக் காட்டு",
    migrationBackup: "அமைப்பு மாற்றங்களைச் செய்வதற்கு முன் நிறுவனத் தரவுத்தளத்தை காப்புப் பிரதி எடுக்கவும்.",
    migrationRunFrom: "ERP திட்டக் கோப்புறையில் PowerShell திறந்து தரவுத்தள அமைப்பு நிலையை முதலில் சரிபார்க்கவும்:",
    migrationApply: "மாற்றங்கள் நிலுவையில் இருந்தால், காப்புப் பிரதி இருப்பதை உறுதிசெய்து பிறகு அவற்றைப் பயன்படுத்தவும்:",
    migrationRestart: "மாற்றம் முடிந்ததும் Ctrl+C அழுத்தி API-ஐ நிறுத்தி, மீண்டும் தொடங்கவும்:",
    databaseConflict: "இந்த கோரிக்கை ஏற்கனவே உள்ள தரவுகளுடன் முரண்படுகிறது. பக்கத்தைப் புதுப்பித்து மீண்டும் முயற்சிக்கவும்.",
    invalidCredentials: "மின்னஞ்சல் அல்லது கடவுச்சொல் தவறாக உள்ளது.",
    invalidSecondFactor: "அங்கீகார அல்லது மீட்புக் குறியீடு தவறாக உள்ளது. மீண்டும் முயற்சிக்கவும்.",
    serverUnavailable: "ERP சேவையகத்துடன் இணைக்க முடியவில்லை.",
    firstSetup: "முதல் முறை அமைப்பு",
    setupHeadline: "உங்கள் வணிகப் பணியிடத்தை அமைக்கவும்.",
    setupCopy: "நிறுவனத்தையும் முதல் உரிமையாளர் உள்நுழைவையும் உருவாக்குங்கள். உள்நுழைந்த பிறகு நிறுவன விவரத்தை மாற்றி, கிளைகளை அமைத்து, மேலாளர் அல்லது காசாளர் கணக்குகளை உருவாக்கலாம்.",
    setupFooter: "தனிப்பட்ட அமைப்பு · உரிமையாளர் அணுகல் · தணிக்கைக்குத் தயார்",
    createOwnerTitle: "உரிமையாளர் கணக்கை உருவாக்கவும்",
    workspaceCreated: "பணியிடம் உருவாக்கப்பட்டது",
    ownerAccountReady: "நிறுவனமும் உரிமையாளர் உள்நுழைவும் தயாராக உள்ளன. பெயர்/லோகோவை மாற்றவும், தேவையான கிளைகளை உருவாக்கவும், மேலாளர் அல்லது காசாளர் கணக்குகளைச் சேர்க்கவும் உரிமையாளராக உள்நுழையுங்கள்.",
    setupExplanation: "இங்கே முதல் உரிமையாளர் கணக்கை மட்டும் உருவாக்குங்கள். உள்நுழைந்த பிறகு நிறுவன விவரத்தில் பெயர்/லோகோவை மாற்றுங்கள். தேவைப்பட்டால் பயனர் அணுகலில் முதலில் கிளைகளை உருவாக்கி, பின்னர் தனித்த கடவுச்சொல்லுடன் மேலாளர் அல்லது காசாளர் கணக்கைச் சேர்க்கவும். அனைவரும் ஒரே உள்நுழைவு பக்கத்தைப் பயன்படுத்துவார்கள்; பொதுப் பதிவு மூடப்பட்டிருக்கும்.",
    setupRolesNote: "முதலில் ஒரே உரிமையாளர் கணக்கை உருவாக்குங்கள். பின்னர் நிறுவனப் பெயர்/லோகோவை மாற்றி, தேவைப்பட்டால் கிளைகளை உருவாக்கி, பயனர் அணுகலில் மேலாளர்/காசாளர் கணக்குகளைச் சேர்க்கவும். பணியாளர்களுக்கு தாங்களாகப் பதிவு இல்லை.",
    setupOwnerLogin: "உரிமையாளர் உள்நுழைவு மின்னஞ்சல்",
    setupAfterLoginTitle: "உரிமையாளராக உள்நுழைந்த பிறகு",
    setupStepCompany: "நிறுவன விவரத்தைத் திறந்து காணப்படும் பெயரை மாற்றி நிறுவன லோகோவைப் பதிவேற்றவும்.",
    setupStepUsers: "பயனர் அணுகலைத் திறக்கவும். தேவைப்பட்டால் முதலில் கிளைகளை உருவாக்கி, பின்னர் மேலாளர்/காசாளர் கணக்குகளையும் தனிக் கடவுச்சொல் மற்றும் கிளை அணுகலையும் அமைக்கவும்.",
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
    dashboardIntro: "இந்த பணியிடத்தில் உற்பத்தி, சரக்கு, விற்பனை, விநியோகம், கொள்முதல், பணியாளர் மற்றும் கணக்குகளை நிர்வகிக்கவும்.",
    dashboardKpis: "வணிகச் சுருக்கம்",
    dashboardPeriod: "விற்பனை, வசூல், செலவுகள் மற்றும் உற்பத்தி இந்த காலத்தைப் பயன்படுத்தும். சரக்கு மற்றும் வரவேண்டிய தொகை தற்போதையவை.",
    fromDate: "தொடக்கம்",
    toDate: "முடிவு",
    applyDateRange: "தேதிகளைப் பயன்படுத்து",
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
    ownerPulseTitle: "உரிமையாளர் கட்டுப்பாட்டு பார்வை",
    ownerPulseAsOf: "{date} நிலவரம் · {scope}",
    ownerPulseRange: "{from} முதல் {to} வரையிலான செயல்பாடுகள்",
    ownerPulseBalanceAsOf: "{date} நிலவர இருப்பு",
    ownerPulseOpenAsOf: "{date} அன்று நிலுவையில்",
    ownerPulseCompany: "அனைத்து கிளைகள்",
    ownerPulseBranch: "தேர்ந்தெடுத்த கிளை",
    ownerPulseSupplier: "வழங்குநர் நிலுவை",
    ownerPulseCashBank: "ரொக்கம் மற்றும் வங்கி",
    ownerPulseCash: "ரொக்கம்",
    negativeCashTitle: "ரொக்க இருப்பு எதிர்மறையாக உள்ளது",
    negativeCashCopy: "ரொக்கப் பதிவுகளையும் தொடக்க இருப்பையும் சரிபார்க்கவும். இந்த அறிவிப்பு எந்தப் பதிவையும் மாற்றாது.",
    negativeCashLink: "ரொக்கம் மற்றும் வங்கிப் புத்தகத்தைப் பார்க்கவும்",
    ownerPulseBank: "வங்கி",
    ownerPulseLoading: "ஏற்றுதல் மற்றும் விநியோகம்",
    ownerPulseOpenLoadings: "முடிக்காத ஏற்றுதல்கள்",
    ownerPulseMismatches: "அளவு வேறுபாடுகள்",
    ownerPulseBroker: "தரகர் கமிஷன் நிலுவை",
    ownerPulsePeople: "பணியாளர் கணக்கு நிலுவைகள்",
    ownerPulseAdvances: "பணியாளர் முன்பணம்",
    ownerPulseSalary: "சம்பள நிலுவை",
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
    modulesIntro: "வணிகப் பதிவுகளை உள்ளிட அல்லது பார்க்க ‘தயார்’ எனக் குறிக்கப்பட்ட பிரிவைத் திறக்கவும். திட்டமிடப்பட்டவை தனியாகக் குறிக்கப்பட்டுள்ளன.",
    foundationPhase: "தற்போது + திட்டமிட்டவை",
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

export function localizedApiError(locale: Locale, code: unknown, message: unknown, fallback: string) {
  if (locale === "en") return typeof message === "string" && message ? message : fallback;
  switch (code) {
    case "VALIDATION_ERROR": return messages.ta.checkFormDetails;
    case "FORBIDDEN":
    case "BRANCH_ACCESS_DENIED": return messages.ta.permissionDenied;
    case "DUPLICATE_VALUE": return messages.ta.duplicateValue;
    case "DATA_CONFLICT": return messages.ta.databaseConflict;
    case "SERVICE_UNAVAILABLE": return messages.ta.databaseUnavailable;
    case "DATABASE_CONFIGURATION": return messages.ta.databaseConfiguration;
    case "MIGRATIONS_REQUIRED": return messages.ta.migrationsRequired;
    case "INTERNAL_ERROR": return messages.ta.serverRequestFailed;
    case "INVALID_CREDENTIALS": return messages.ta.invalidCredentials;
    default: return fallback;
  }
}

export function apiRequestError(body: unknown, fallback: string, status?: number) {
  const root = body && typeof body === "object" ? body as { error?: unknown } : {};
  const details = root.error && typeof root.error === "object"
    ? root.error as { code?: unknown; message?: unknown; requestId?: unknown }
    : {};
  const message = typeof details.message === "string" ? details.message : fallback;
  return Object.assign(new Error(message), {
    code: typeof details.code === "string" ? details.code : undefined,
    requestId: typeof details.requestId === "string" ? details.requestId : undefined,
    status,
  });
}

export function localizedUiError(error: unknown, locale: Locale, fallback: string) {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; status?: unknown; requestId?: unknown } : {};
  const message = typeof value.message === "string" ? value.message : error instanceof Error ? error.message : "";
  if (locale === "en") return message || fallback;
  if (/[\u0B80-\u0BFF]/.test(message)) return message;
  if (typeof value.code === "string") {
    const translated = localizedApiError(locale, value.code, message, fallback);
    const reference = value.code === "INTERNAL_ERROR" && typeof value.requestId === "string" ? value.requestId : "";
    return reference ? `${translated} ${messages.ta.errorReference}: ${reference}` : translated;
  }
  const status = Number(value.status);
  if (status === 400) return messages.ta.checkFormDetails;
  if (status === 403) return messages.ta.permissionDenied;
  if (status === 409) return messages.ta.databaseConflict;
  if (status >= 500) {
    const reference = typeof value.requestId === "string" ? value.requestId : "";
    return `${messages.ta.serverRequestFailed}${reference ? ` ${messages.ta.errorReference}: ${reference}` : ""}`;
  }
  return fallback;
}

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
  useEffect(()=>{const token=sessionStorage.getItem("brick-erp-session");if(!token)return;void fetch(`/api/auth/branches`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(d?.branches){setBranches(d.branches);setCurrent(d.currentBranchId??null);setCanViewAll(Boolean(d.canViewAll))}}).catch(()=>undefined)},[]);
  async function change(branchId:string){const token=sessionStorage.getItem("brick-erp-session");if(!token)return;setSaving(true);try{const r=await fetch(`/api/auth/branch`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({branchId:branchId||null})});if(r.ok){try{sessionStorage.setItem("brick-erp-offline-branch-scope",JSON.stringify({fingerprint:`${token.length}:${token.slice(0,12)}:${token.slice(-12)}`,branchId:branchId||null,savedAt:new Date().toISOString()}))}catch{/* The dashboard refreshes its scope from the API. */}window.location.reload()}}finally{setSaving(false)}}
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
          <option value="en">{t("englishLanguage")}</option>
          <option value="ta">தமிழ்</option>
        </select>
      </label>
    </>
  );
}
