"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./i18n";
import { Icon, type IconName } from "./visuals";

type MobileNavKey="home"|"operations"|"approvals"|"reports"|"masters"|"production"|"sales"|"loading"|"purchases"|"accounting"|"payroll"|"account";
type MenuItem={key:string;icon:IconName;href:string;section:"navigation"|"administration"|"myAccount";permission?:string;anyPermissions?:string[];ownerOnly?:boolean};
const API="";

type WorkspaceLink={href:string;icon:IconName;en:string;ta:string;permission?:string;anyPermissions?:string[];ownerOnly?:boolean};
const workspaceLinks:WorkspaceLink[]=[
 {href:"/dashboard",icon:"home",en:"Overview",ta:"கண்ணோட்டம்"},
 {href:"/operations",icon:"boxes",en:"Operations",ta:"செயல்பாடுகள்"},
 {href:"/masters",icon:"boxes",en:"Business masters",ta:"வணிக அடிப்படைத் தகவல்கள்",permission:"masters.view"},
 {href:"/production",icon:"factory",en:"Production",ta:"உற்பத்தி",anyPermissions:["production.view","production.create"]},
 {href:"/sales",icon:"receipt",en:"Sales",ta:"விற்பனை",anyPermissions:["sales.view","sales.create"]},
 {href:"/brokers",icon:"users",en:"Broker commissions",ta:"தரகர் கமிஷன்",permission:"brokers.commission.view"},
 {href:"/loading",icon:"truck",en:"Loading & delivery",ta:"ஏற்றுதல் மற்றும் விநியோகம்",permission:"loading.view"},
 {href:"/purchases",icon:"shopping",en:"Purchases",ta:"கொள்முதல்",anyPermissions:["purchases.view","purchases.create"]},
 {href:"/stock-returns",icon:"receipt",en:"Stock returns",ta:"சரக்கு திரும்பப் பெறல்",permission:"stock.return.create"},
 {href:"/expenses",icon:"calculator",en:"Expenses",ta:"செலவுகள்",anyPermissions:["expenses.view","expenses.create"]},
 {href:"/people",icon:"users",en:"People & attendance",ta:"பணியாளர்கள் மற்றும் வருகை",anyPermissions:["employees.view","attendance.view"]},
 {href:"/people/ledger",icon:"calculator",en:"Employee ledger",ta:"பணியாளர் பேரேடு",permission:"employees.view"},
 {href:"/payroll",icon:"cash",en:"Payroll",ta:"சம்பளம்",anyPermissions:["payroll.view","payroll.run.create"]},
 {href:"/accounting/accounts",icon:"calculator",en:"Accounts",ta:"கணக்குகள்",permission:"accounting.view"},
 {href:"/reports",icon:"chart",en:"Financial reports",ta:"நிதி அறிக்கைகள்",anyPermissions:["sales.view","stock.view","production.view","purchases.view","accounting.view","audit.view"]},
 {href:"/approvals",icon:"check",en:"Approvals",ta:"ஒப்புதல்கள்",anyPermissions:["expenses.approve","stocktake.approve","cash.close.approve","loading.approve","brokers.commission.approve","sales.approve","employees.advance.approve","accounting.journal.approve","payroll.approve"]},
 {href:"/notifications",icon:"bell",en:"Notifications",ta:"அறிவிப்புகள்"},
];
const masterLinks:WorkspaceLink[]=[
 {href:"/masters",icon:"boxes",en:"Customers, suppliers & products",ta:"வாடிக்கையாளர்கள், வழங்குநர்கள் மற்றும் பொருட்கள்",permission:"masters.view"},
 {href:"/masters/tax-codes",icon:"calculator",en:"HSN / tax codes",ta:"HSN / வரிக் குறியீடுகள்",permission:"masters.view"},
 {href:"/masters/units",icon:"boxes",en:"Product units",ta:"பொருள் அலகுகள்",permission:"masters.view"},
];
const reportLinks:WorkspaceLink[]=[
 {href:"/reports",icon:"chart",en:"Trial balance & profit / loss",ta:"சோதனை இருப்பு மற்றும் லாப நஷ்டம்",permission:"accounting.view"},
 {href:"/reports/balance-sheet",icon:"chart",en:"Balance sheet",ta:"இருப்புநிலை",permission:"accounting.view"},
 {href:"/reports/cash-bank-book",icon:"cash",en:"Cash / bank book",ta:"ரொக்கம் / வங்கிப் பதிவேடு",permission:"accounting.view"},
 {href:"/reports/cash-closing",icon:"cash",en:"Cash closing",ta:"ரொக்கக் கணக்கு முடிப்பு",permission:"accounting.view"},
 {href:"/reports/bank-reconciliation",icon:"chart",en:"Bank reconciliation",ta:"வங்கி ஒப்பீடு",permission:"bank.reconcile.view"},
 {href:"/reports/customer-aging",icon:"calendar",en:"Customer overdue aging",ta:"வாடிக்கையாளர் காலதாமத நிலுவை",permission:"sales.view"},
 {href:"/reports/sales",icon:"receipt",en:"Sales register",ta:"விற்பனைப் பதிவேடு",permission:"sales.view"},
 {href:"/reports/purchases",icon:"shopping",en:"Purchase register",ta:"கொள்முதல் பதிவேடு",permission:"purchases.view"},
 {href:"/reports/stock",icon:"boxes",en:"Stock report",ta:"சரக்கு அறிக்கை",permission:"stock.view"},
 {href:"/reports/production",icon:"factory",en:"Production report",ta:"உற்பத்தி அறிக்கை",permission:"production.view"},
 {href:"/reports/loading",icon:"truck",en:"Loading register",ta:"ஏற்றுதல் பதிவேடு",permission:"loading.view"},
 {href:"/reports/expenses",icon:"calculator",en:"Expense report",ta:"செலவு அறிக்கை",permission:"expenses.view"},
 {href:"/reports/labour",icon:"users",en:"Labour / department cost",ta:"தொழிலாளர் / துறைச் செலவு",permission:"payroll.view"},
 {href:"/reports/brokers",icon:"users",en:"Broker commission",ta:"தரகர் கமிஷன்",permission:"sales.view"},
 {href:"/reports/branches",icon:"chart",en:"Branch trading",ta:"கிளை வணிக ஒப்பீடு",ownerOnly:true},
 {href:"/reports/subledger-reconciliation",icon:"shield",en:"Control account check",ta:"பேரேடு ஒப்பீடு",permission:"accounting.view"},
 {href:"/reports/period-close",icon:"shield",en:"Month-end close",ta:"மாத இறுதிக் கணக்கு முடிப்பு",permission:"accounting.period.close.view"},
 {href:"/reports/financial-years",icon:"calendar",en:"Financial years",ta:"நிதியாண்டுகள்",permission:"accounting.financial-years.view"},
];
const accountLinks:WorkspaceLink[]=[
 {href:"/account/sessions",icon:"user",en:"My devices",ta:"என் சாதனங்கள்"},
 {href:"/account/security",icon:"shield",en:"Account security",ta:"கணக்கு பாதுகாப்பு"},
];
const accountingLinks:WorkspaceLink[]=[
 {href:"/accounting/accounts",icon:"calculator",en:"Chart of accounts",ta:"கணக்குப் பட்டியல்",permission:"accounting.view"},
 {href:"/accounting/journals",icon:"receipt",en:"Manual journals",ta:"கைமுறைப் பதிவுகள்",permission:"accounting.view"},
];
const adminLinks:WorkspaceLink[]=[
 {href:"/admin/company",icon:"building",en:"Company profile",ta:"நிறுவன விவரம்",ownerOnly:true},
 {href:"/admin/payment-modes",icon:"cash",en:"Payment methods",ta:"பணம் செலுத்தும் முறைகள்",ownerOnly:true},
 {href:"/admin/users",icon:"users",en:"User access",ta:"பயனர் அணுகல்",permission:"users.view"},
 {href:"/admin/roles",icon:"shield",en:"Roles & permissions",ta:"பங்குகள் மற்றும் அனுமதிகள்",permission:"users.roles.manage"},
 {href:"/admin/sequences",icon:"receipt",en:"Document numbers",ta:"ஆவண எண்கள்",ownerOnly:true},
 {href:"/audit",icon:"shield",en:"Audit center",ta:"தணிக்கை மையம்",permission:"audit.view"},
 {href:"/assistant",icon:"chart",en:"Owner assistant",ta:"உரிமையாளர் உதவியாளர்",ownerOnly:true},
];

export function WorkspaceSidebar({disabled=false}:{disabled?:boolean}){
 const {locale}=useLocale(),pathname=usePathname()??"";
 const sidebarRef=useRef<HTMLElement>(null);
 const [access,setAccess]=useState<{owner:boolean;permissions:string[];fullName:string;roleName:string}|null>(null);
 const [expanded,setExpanded]=useState<Record<string,boolean>>({operations:["/operations","/masters","/production","/sales","/brokers","/loading","/purchases","/stock-returns","/expenses","/people","/payroll","/accounting"].some(path=>pathname===path||pathname.startsWith(`${path}/`)),reports:pathname.startsWith("/reports"),admin:pathname.startsWith("/admin/")||pathname==="/audit"||pathname==="/assistant",account:pathname.startsWith("/account/")});
 const toggle=(key:string,open:boolean)=>setExpanded(current=>current[key]===open?current:{...current,[key]:open});
 useEffect(()=>{const token=sessionStorage.getItem("brick-erp-session");if(!token)return;let live=true;void fetch(`${API}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}).then(async response=>response.ok?response.json():null).then(data=>{if(!live||!data?.user)return;const user=data.user as {fullName?:string;permissions?:string[];roles?:Array<{code:string;name:string}>};const owner=(user.roles??[]).some(role=>role.code==="owner");setAccess({owner,permissions:user.permissions??[],fullName:user.fullName??"",roleName:owner?(locale==="ta"?"உரிமையாளர்":"Owner"):(user.roles??[]).map(role=>role.name).join(", ")})}).catch(()=>undefined);return()=>{live=false}},[locale]);
 useEffect(()=>{if(!access||window.matchMedia("(max-width: 680px)").matches)return;const active=sidebarRef.current?.querySelector<HTMLElement>('.workspace-subitem[aria-current="page"]')??sidebarRef.current?.querySelector<HTMLElement>('.nav-item[aria-current="page"]');active?.scrollIntoView({block:"nearest"})},[access,pathname]);
 async function signOut(){const token=sessionStorage.getItem("brick-erp-session");if(token)await fetch(`${API}/api/auth/logout`,{method:"POST",headers:{Authorization:`Bearer ${token}`}}).catch(()=>undefined);sessionStorage.removeItem("brick-erp-session");for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(key?.startsWith("brick-erp-offline-"))sessionStorage.removeItem(key)}window.location.replace("/")}
 const allowed=(item:WorkspaceLink)=>!access?item.href==="/dashboard"||item.href.startsWith("/account/")||item.href==="/notifications":access.owner||item.ownerOnly===undefined&&(!item.permission||access.permissions.includes(item.permission))&&(!item.anyPermissions||item.anyPermissions.some(code=>access.permissions.includes(code)));
 const label=(item:WorkspaceLink)=>locale==="ta"?item.ta:item.en;
 const link=(item:WorkspaceLink,child=false)=>{const exact=pathname===item.href,active=exact||!child&&pathname.startsWith(`${item.href}/`);return <a key={item.href} href={item.href} className={`${child?"workspace-subitem":"nav-item"}${active?" active":""}`} aria-current={exact?"page":undefined}><Icon name={item.icon} size={child?15:17}/><span>{label(item)}</span></a>};
 const operations=workspaceLinks.filter(item=>!["/dashboard","/reports","/approvals","/notifications"].includes(item.href)).filter(allowed);
 const reports=workspaceLinks.find(item=>item.href==="/reports");
 const reportMenu=reportLinks.filter(allowed);
 const administration=adminLinks.filter(allowed);
 const account=accountLinks.filter(allowed);
 const navEntry=(item:WorkspaceLink)=><div key={item.href}>{link(item)}{item.href==="/masters"&&pathname.startsWith("/masters")&&<div className="workspace-subnav" aria-label={locale==="ta"?"வணிக அடிப்படைத் தகவல்கள்":"Business masters"}>{masterLinks.filter(allowed).map(sub=>link(sub,true))}</div>}{item.href==="/accounting/accounts"&&pathname.startsWith("/accounting")&&<div className="workspace-subnav">{accountingLinks.filter(allowed).map(sub=>link(sub,true))}</div>}</div>;
 return <aside ref={sidebarRef} className="sidebar workspace-sidebar"><CompanyBrand href="/dashboard"/><nav inert={disabled} aria-label={locale==="ta"?"பணியிட வழிசெலுத்தல்":"Workspace navigation"}>
  <div className="workspace-nav-section"><div className="nav-label">{locale==="ta"?"முகப்பு":"WORKSPACE"}</div>{link(workspaceLinks[0])}{workspaceLinks.filter(item=>["/approvals","/notifications"].includes(item.href)&&allowed(item)).map(linkItem=>link(linkItem))}</div>
  {operations.length>0&&<details className="workspace-nav-section workspace-nav-details" open={expanded.operations} onToggle={event=>toggle("operations",event.currentTarget.open)}><summary>{locale==="ta"?"செயல்பாடுகள்":"Operations"}</summary><div className="workspace-nav-entries">{operations.map(navEntry)}</div></details>}
  {reports&&allowed(reports)&&<details className="workspace-nav-section workspace-nav-details" open={expanded.reports} onToggle={event=>toggle("reports",event.currentTarget.open)}><summary>{locale==="ta"?"அறிக்கைகள்":"Reports"}</summary><div className="workspace-nav-entries">{link(reports)}{reportMenu.length>0&&<div className="workspace-subnav">{reportMenu.map(item=>link(item,true))}</div>}</div></details>}
  {administration.length>0&&<details className="workspace-nav-section workspace-nav-details" open={expanded.admin} onToggle={event=>toggle("admin",event.currentTarget.open)}><summary>{locale==="ta"?"நிர்வாகம்":"Administration"}</summary><div className="workspace-nav-entries">{administration.map(linkItem=>link(linkItem))}</div></details>}
  {account.length>0&&<details className="workspace-nav-section workspace-nav-details" open={expanded.account} onToggle={event=>toggle("account",event.currentTarget.open)}><summary>{locale==="ta"?"என் கணக்கு":"My account"}</summary><div className="workspace-nav-entries">{account.map(linkItem=>link(linkItem))}</div></details>}
 </nav>{access&&<div className="sidebar-bottom"><div className="avatar">{access.fullName.slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{access.fullName}</b><span>{access.roleName}</span></div><button className="signout" type="button" onClick={()=>void signOut()} aria-label={locale==="ta"?"வெளியேறு":"Sign out"}><Icon name="logout" size={17}/></button></div>}</aside>;
}

export function MobileNavigation({active,disabled=false}:{active:MobileNavKey|null;disabled?:boolean}){
 const {locale}=useLocale();
 const pathname=usePathname()??"";
 const [moreOpen,setMoreOpen]=useState(false),[permissions,setPermissions]=useState<string[]|null>(null),[owner,setOwner]=useState(false);
 const fullNavLabels:Partial<Record<MobileNavKey,string>>=locale==="ta"?{operations:"செயல்பாடுகள்",approvals:"ஒப்புதல்கள்",reports:"அறிக்கைகள்"}:{};
 const moreMenuRef=useRef<HTMLElement>(null),moreButtonRef=useRef<HTMLButtonElement>(null);
 const labels=locale==="ta"?{home:"முகப்பு",operations:"செயல்",approvals:"ஒப்புதல்",reports:"அறிக்கை",masters:"அடிப்படை",production:"உற்பத்தி",sales:"விற்பனை",loading:"விநியோகம்",purchases:"கொள்முதல்",accounting:"கணக்கு",payroll:"சம்பளம்",account:"சாதனங்கள்",more:"மேலும்",notifications:"அறிவிப்புகள்",company:"நிறுவன விவரம்",paymentModes:"பணம் செலுத்தும் முறைகள்",users:"பயனர் அணுகல்",roles:"பங்குகள்",sequences:"ஆவண எண்கள்",stockReturns:"சரக்கு திரும்பப் பெறல்",audit:"தணிக்கை",navigation:"வழிசெலுத்தல்",administration:"நிர்வாகம்",myAccount:"என் கணக்கு"}:{home:"Home",operations:"Operations",approvals:"Approvals",reports:"Reports",masters:"Masters",production:"Production",sales:"Sales",loading:"Delivery",purchases:"Purchases",accounting:"Accounts",payroll:"Payroll",account:"My devices",more:"More",notifications:"Notifications",company:"Company profile",paymentModes:"Payment methods",users:"User access",roles:"Roles and permissions",sequences:"Document numbers",stockReturns:"Stock returns",audit:"Audit center",navigation:"Navigate",administration:"Administration",myAccount:"My account"};

 useEffect(()=>{
  const token=sessionStorage.getItem("brick-erp-session");
  if(!token||disabled)return;
  let live=true;
  void fetch(`${API}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"})
   .then(async response=>response.ok?response.json():null)
   .then(data=>{if(!live||!data?.user)return;const user=data.user as {permissions?:string[];roles?:Array<{code:string}>};setPermissions(user.permissions??[]);setOwner((user.roles??[]).some(role=>role.code==="owner"))})
   .catch(()=>undefined);
  return()=>{live=false};
 },[disabled]);

 useEffect(()=>{
  if(!moreOpen||disabled)return;
  const menu=moreMenuRef.current;
  if(!menu)return;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const focusable=()=>Array.from(menu.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  focusable()[0]?.focus();
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();setMoreOpen(false);return}
   if(event.key!=="Tab")return;
   const controls=focusable(),first=controls[0],last=controls[controls.length-1],active=document.activeElement;
   if(!first||!last){event.preventDefault();menu.focus();return}
   if(event.shiftKey&&(active===first||!menu.contains(active))){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&(active===last||!menu.contains(active))){event.preventDefault();first.focus()}
  };
  document.addEventListener("keydown",onKeyDown);
  return()=>{document.removeEventListener("keydown",onKeyDown);document.body.style.overflow=previousOverflow;moreButtonRef.current?.focus()};
 },[moreOpen,disabled]);

 useEffect(()=>{if(disabled&&moreOpen)setMoreOpen(false)},[disabled,moreOpen]);

 const granted=permissions??[];
 Object.assign(labels,{assistant:locale==="ta"?"உரிமையாளர் உதவியாளர்":"Owner assistant"});
 const items=useMemo<MenuItem[]>(()=>[
  {key:"reports",icon:"chart",href:"/reports",section:"navigation",anyPermissions:["sales.view","stock.view","production.view","purchases.view","accounting.view","audit.view"]},
  {key:"masters",icon:"boxes",href:"/masters",section:"navigation",permission:"masters.view"},
  {key:"production",icon:"factory",href:"/production",section:"navigation",anyPermissions:["production.view","production.create"]},
  {key:"sales",icon:"receipt",href:"/sales",section:"navigation",anyPermissions:["sales.view","sales.create"]},
  {key:"loading",icon:"truck",href:"/loading",section:"navigation",permission:"loading.view"},
  {key:"purchases",icon:"shopping",href:"/purchases",section:"navigation",anyPermissions:["purchases.view","purchases.create"]},
  {key:"accounting",icon:"calculator",href:"/accounting/accounts",section:"navigation",permission:"accounting.view"},
  {key:"payroll",icon:"cash",href:"/payroll",section:"navigation",anyPermissions:["payroll.view","payroll.run.create","employees.view"]},
  {key:"stockReturns",icon:"receipt",href:"/stock-returns",section:"navigation",permission:"stock.return.create"},
  {key:"approvals",icon:"check",href:"/approvals",section:"navigation",anyPermissions:granted.filter(code=>code.includes("approve")||code.includes("approval"))},
  {key:"notifications",icon:"bell",href:"/notifications",section:"navigation"},
  {key:"audit",icon:"shield",href:"/audit",section:"administration",permission:"audit.view"},
  {key:"assistant",icon:"chart",href:"/assistant",section:"administration",ownerOnly:true},
  {key:"company",icon:"building",href:"/admin/company",section:"administration",ownerOnly:true},
  {key:"paymentModes",icon:"cash",href:"/admin/payment-modes",section:"administration",ownerOnly:true},
  {key:"sequences",icon:"receipt",href:"/admin/sequences",section:"administration",ownerOnly:true},
  {key:"users",icon:"users",href:"/admin/users",section:"administration",permission:"users.view"},
  {key:"roles",icon:"settings",href:"/admin/roles",section:"administration",permission:"users.roles.manage"},
  {key:"account",icon:"user",href:"/account/sessions",section:"myAccount"},
 ],[permissions]);
 const visible=items.filter(item=>item.ownerOnly?owner:item.permission?granted.includes(item.permission):item.anyPermissions?item.anyPermissions.some(permission=>granted.includes(permission)):true);
 const contextLinks=pathname.startsWith("/masters")?masterLinks:pathname.startsWith("/reports")?reportLinks:pathname.startsWith("/accounting")?accountingLinks:[];
 const visibleContext=contextLinks.filter(item=>owner||!item.ownerOnly&&(!item.permission||granted.includes(item.permission))&&(!item.anyPermissions||item.anyPermissions.some(permission=>granted.includes(permission))));
 const contextTitle=pathname.startsWith("/masters")?(locale==="ta"?"வணிக அடிப்படைத் தகவல்கள்":"Business masters"):pathname.startsWith("/reports")?(locale==="ta"?"அறிக்கைகள்":"Reports"):(locale==="ta"?"கணக்குகள்":"Accounts");
 const staffPriority=["sales","production","loading","purchases","accounting","payroll","reports","masters"];
 const staffPrimary:Array<[MobileNavKey,IconName,string]>=[["home","home","/dashboard"],...staffPriority.flatMap(key=>{const item=visible.find(candidate=>candidate.key===key);return item?[[key as MobileNavKey,item.icon,item.href] as [MobileNavKey,IconName,string]]:[]}).slice(0,3)];
 const primary:Array<[MobileNavKey,IconName,string]>=owner?[["home","home","/dashboard"],["operations","boxes","/operations"],["approvals","check","/approvals"],["reports","chart","/reports"]]:staffPrimary;
 const pathActive=primary.find(([key,,href])=>active===key||pathname===href||pathname.startsWith(`${href}/`));
 const primaryActive=pathActive??(owner&&["sales","production","loading","purchases","masters","payroll","accounting"].includes(active??"")?primary.find(([key])=>key==="operations"):undefined);
 const moreActive=!primaryActive;

 return <>
  {moreOpen&&!disabled&&<><button type="button" className="mobile-more-backdrop" aria-hidden="true" tabIndex={-1} onClick={()=>setMoreOpen(false)}/><section ref={moreMenuRef} id="mobile-more-menu" className="mobile-more-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" tabIndex={-1}><div className="mobile-more-heading"><b id="mobile-more-title">{labels.more}</b><button type="button" onClick={()=>setMoreOpen(false)} aria-label={locale==="ta"?"மூடு":"Close"}>×</button></div>{visibleContext.length>0&&<div className="mobile-more-section"><div className="mobile-more-caption">{contextTitle}</div><div className="mobile-more-grid">{visibleContext.map(item=><a key={item.href} href={item.href} aria-current={pathname===item.href?"page":undefined} onClick={()=>setMoreOpen(false)}><Icon name={item.icon} size={18}/><span>{locale==="ta"?item.ta:item.en}</span></a>)}</div></div>}{(["navigation","administration","myAccount"] as const).map(section=>{const sectionItems=visible.filter(item=>item.section===section);return sectionItems.length?<div key={section} className="mobile-more-section"><div className="mobile-more-caption">{labels[section]}</div><div className="mobile-more-grid">{sectionItems.map(item=><a key={item.key} href={item.href} onClick={()=>setMoreOpen(false)}><Icon name={item.icon} size={18}/><span>{labels[item.key as keyof typeof labels]??item.key}</span></a>)}</div></div>:null})}</section></>}
  <nav className={`mobile-bottom-nav${disabled?" disabled":""}`} aria-label={locale==="ta"?"முதன்மை வழிசெலுத்தல்":"Main navigation"}>
   {primary.map(([key,icon,href])=>disabled?<span key={key} className={primaryActive?.[0]===key?"mobile-nav-item active":"mobile-nav-item"} aria-label={fullNavLabels[key]??labels[key]} aria-disabled="true"><Icon name={icon} size={19}/><span>{labels[key]}</span></span>:<a key={key} href={href} className={primaryActive?.[0]===key?"mobile-nav-item active":"mobile-nav-item"} aria-label={fullNavLabels[key]??labels[key]} aria-current={primaryActive?.[0]===key?"page":undefined}><Icon name={icon} size={19}/><span>{labels[key]}</span></a>)}
   <button ref={moreButtonRef} type="button" className={`mobile-nav-item${moreActive||moreOpen?" active":""}`} aria-expanded={moreOpen} aria-haspopup="dialog" aria-controls="mobile-more-menu" disabled={disabled} onClick={()=>setMoreOpen(value=>!value)}><Icon name="settings" size={19}/><span>{labels.more}</span></button>
  </nav>
 </>;
}


/** Desktop administration navigation follows the same server-issued access as the mobile menu. */
export function AdminSidebar({active}:{active:"company"|"users"|"roles"|"payment-modes"}){
 const {locale}=useLocale();
 const [access,setAccess]=useState<{owner:boolean;permissions:string[]}>({owner:false,permissions:[]});
 useEffect(()=>{
  const token=sessionStorage.getItem("brick-erp-session");
  if(!token)return;
  let live=true;
  void fetch(API+"/api/auth/me",{headers:{Authorization:"Bearer "+token},cache:"no-store"})
   .then(async response=>response.ok?response.json():null)
   .then(data=>{if(!live||!data?.user)return;const user=data.user as {permissions?:string[];roles?:Array<{code:string}>};setAccess({owner:(user.roles??[]).some(role=>role.code==="owner"),permissions:user.permissions??[]})})
   .catch(()=>undefined);
  return()=>{live=false};
 },[]);
 const granted=new Set(access.permissions);
 const canUsers=granted.has("users.view");
 const canReports=["reports.view","sales.view","stock.view","production.view","purchases.view","accounting.view","payroll.view","employees.view","audit.view"].some(code=>granted.has(code));
 const labels=locale==="ta"?{section:"நிர்வாகம்",home:"கண்ணோட்டம்",company:"நிறுவன விவரம்",paymentModes:"பணம் செலுத்தும் முறைகள்",users:"பயனர் அணுகல்",roles:"பங்குகள் மற்றும் அனுமதிகள்",reports:"நிதி அறிக்கைகள்",audit:"தணிக்கை மையம்",sequences:"ஆவண எண்கள்"}:{section:"Administration",home:"Overview",company:"Company profile",paymentModes:"Payment methods",users:"User access",roles:"Roles and permissions",reports:"Financial reports",audit:"Audit center",sequences:"Document numbers"};
 const link=(key:string,href:string,icon:IconName,label:string)=><a key={key} className={active===key?"nav-item active":"nav-item"} href={href} aria-current={active===key?"page":undefined}><Icon name={icon} size={17}/>{label}</a>;
 return <aside className="sidebar"><CompanyBrand href="/dashboard"/><div className="nav-label">{labels.section.toUpperCase()}</div>{link("home","/dashboard","home",labels.home)}{access.owner&&link("company","/admin/company","building",labels.company)}{access.owner&&link("payment-modes","/admin/payment-modes","cash",labels.paymentModes)}{canUsers&&link("users","/admin/users","users",labels.users)}{granted.has("users.roles.manage")&&link("roles","/admin/roles","shield",labels.roles)}{canReports&&link("reports","/reports","chart",labels.reports)}{granted.has("audit.view")&&link("audit","/audit","shield",labels.audit)}{access.owner&&link("sequences","/admin/sequences","receipt",labels.sequences)}</aside>;
}

/** Displays the authenticated company's saved identity throughout the workspace. */
export function CompanyBrand({href="/dashboard"}:{href?:string}){
 const [name,setName]=useState("");
 const [logoUrl,setLogoUrl]=useState("");
 useEffect(()=>{
  let live=true;
  let objectUrl="";
  const cacheKey="brick-erp-company-brand";
  const refresh=async()=>{
   const token=sessionStorage.getItem("brick-erp-session");
   if(!token)return;
   try{
    const response=await fetch(`${API}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    if(!response.ok)return;
    const data=await response.json();
    if(live&&typeof data.user?.companyName==="string"){setName(data.user.companyName);try{sessionStorage.setItem(cacheKey,JSON.stringify({fingerprint:`${token.length}:${token.slice(0,12)}:${token.slice(-12)}`,name:data.user.companyName}))}catch{/* Continue without a local brand cache. */}}
    const image=await fetch(`${API}/api/company/profile/logo`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    if(image.status===404){if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl="";if(live)setLogoUrl("");return}
    if(!image.ok)return;
    const next=URL.createObjectURL(await image.blob());
    if(live){if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=next;setLogoUrl(next)}else URL.revokeObjectURL(next);
   }catch{/* Keep the fallback brand when the service is offline. */}
  };
  try{const token=sessionStorage.getItem("brick-erp-session"),cached=JSON.parse(sessionStorage.getItem(cacheKey)??"null") as {fingerprint?:string;name?:string}|null;if(token&&cached?.fingerprint===`${token.length}:${token.slice(0,12)}:${token.slice(-12)}`&&typeof cached.name==="string")setName(cached.name)}catch{/* Ignore malformed or unavailable session storage. */}
  void refresh();
  window.addEventListener("company-profile-updated",refresh);
  return()=>{live=false;window.removeEventListener("company-profile-updated",refresh);if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[]);
 return <a className="sidebar-brand" href={href} aria-label={`${name||"Brick Chamber ERP"} home`}>{logoUrl?<img className="sidebar-company-logo" src={logoUrl} alt=""/>:<span aria-hidden="true">BC</span>}<b>{name||<>Brick Chamber<br/>ERP</>}</b></a>;
}
