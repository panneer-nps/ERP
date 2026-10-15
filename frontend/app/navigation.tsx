"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./i18n";
import { Icon, type IconName } from "./visuals";

type MobileNavKey="home"|"operations"|"approvals"|"reports"|"masters"|"production"|"sales"|"loading"|"purchases"|"accounting"|"payroll"|"account";
type MenuItem={key:string;icon:IconName;href:string;section:"navigation"|"administration"|"myAccount";permission?:string;anyPermissions?:string[];ownerOnly?:boolean};
const API="";

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
 const staffPriority=["sales","production","loading","purchases","accounting","payroll","reports","masters"];
 const staffPrimary:Array<[MobileNavKey,IconName,string]>=[["home","home","/dashboard"],...staffPriority.flatMap(key=>{const item=visible.find(candidate=>candidate.key===key);return item?[[key as MobileNavKey,item.icon,item.href] as [MobileNavKey,IconName,string]]:[]}).slice(0,3)];
 const primary:Array<[MobileNavKey,IconName,string]>=owner?[["home","home","/dashboard"],["operations","boxes","/operations"],["approvals","check","/approvals"],["reports","chart","/reports"]]:staffPrimary;
 const pathActive=primary.find(([key,,href])=>active===key||pathname===href||pathname.startsWith(`${href}/`));
 const primaryActive=pathActive??(owner&&["sales","production","loading","purchases","masters","payroll","accounting"].includes(active??"")?primary.find(([key])=>key==="operations"):undefined);
 const moreActive=!primaryActive;

 return <>
  {moreOpen&&!disabled&&<><button type="button" className="mobile-more-backdrop" aria-hidden="true" tabIndex={-1} onClick={()=>setMoreOpen(false)}/><section ref={moreMenuRef} id="mobile-more-menu" className="mobile-more-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" tabIndex={-1}><div className="mobile-more-heading"><b id="mobile-more-title">{labels.more}</b><button type="button" onClick={()=>setMoreOpen(false)} aria-label={locale==="ta"?"மூடு":"Close"}>×</button></div>{(["navigation","administration","myAccount"] as const).map(section=>{const sectionItems=visible.filter(item=>item.section===section);return sectionItems.length?<div key={section} className="mobile-more-section"><div className="mobile-more-caption">{labels[section]}</div><div className="mobile-more-grid">{sectionItems.map(item=><a key={item.key} href={item.href} onClick={()=>setMoreOpen(false)}><Icon name={item.icon} size={18}/><span>{labels[item.key as keyof typeof labels]??item.key}</span></a>)}</div></div>:null})}</section></>}
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
