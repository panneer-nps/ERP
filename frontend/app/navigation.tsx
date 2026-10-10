"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./i18n";
import { Icon, type IconName } from "./visuals";

type MobileNavKey="home"|"operations"|"approvals"|"reports"|"masters"|"production"|"sales"|"loading"|"purchases"|"accounting"|"payroll"|"account";
type MenuItem={key:string;icon:IconName;href:string;section:"navigation"|"administration"|"myAccount";permission?:string;anyPermissions?:string[];ownerOnly?:boolean};
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";

export function MobileNavigation({active,disabled=false}:{active:MobileNavKey|null;disabled?:boolean}){
 const {locale}=useLocale();
 const pathname=usePathname()??"";
 const [moreOpen,setMoreOpen]=useState(false),[permissions,setPermissions]=useState<string[]>([]),[owner,setOwner]=useState(false);
 const labels=locale==="ta"?{home:"முகப்பு",operations:"செயல்பாடுகள்",approvals:"ஒப்புதல்கள்",reports:"அறிக்கைகள்",masters:"அடிப்படை",production:"உற்பத்தி",sales:"விற்பனை",loading:"விநியோகம்",purchases:"கொள்முதல்",accounting:"கணக்கு",payroll:"சம்பளம்",account:"சாதனங்கள்",more:"மேலும்",notifications:"அறிவிப்புகள்",company:"நிறுவன விவரம்",users:"பயனர் அணுகல்",roles:"பங்குகள்",audit:"தணிக்கை",navigation:"வழிசெலுத்தல்",administration:"நிர்வாகம்",myAccount:"என் கணக்கு"}:{home:"Home",operations:"Operations",approvals:"Approvals",reports:"Reports",masters:"Masters",production:"Production",sales:"Sales",loading:"Delivery",purchases:"Purchases",accounting:"Accounts",payroll:"Payroll",account:"My devices",more:"More",notifications:"Notifications",company:"Company profile",users:"User access",roles:"Roles and permissions",audit:"Audit center",navigation:"Navigate",administration:"Administration",myAccount:"My account"};

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

 useEffect(()=>{if(!moreOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setMoreOpen(false)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[moreOpen]);

 const items=useMemo<MenuItem[]>(()=>[
  {key:"reports",icon:"chart",href:"/reports",section:"navigation",anyPermissions:["sales.view","stock.view","production.view","purchases.view","accounting.view","audit.view"]},
  {key:"masters",icon:"boxes",href:"/masters",section:"navigation",permission:"masters.view"},
  {key:"production",icon:"factory",href:"/production",section:"navigation",anyPermissions:["production.view","production.create"]},
  {key:"sales",icon:"receipt",href:"/sales",section:"navigation",anyPermissions:["sales.view","sales.create"]},
  {key:"loading",icon:"truck",href:"/loading",section:"navigation",permission:"loading.view"},
  {key:"purchases",icon:"shopping",href:"/purchases",section:"navigation",anyPermissions:["purchases.view","purchases.create"]},
  {key:"accounting",icon:"calculator",href:"/accounting/accounts",section:"navigation",permission:"accounting.view"},
  {key:"payroll",icon:"cash",href:"/payroll",section:"navigation",anyPermissions:["payroll.view","payroll.run.create","employees.view"]},
  {key:"approvals",icon:"check",href:"/approvals",section:"navigation",anyPermissions:permissions.filter(code=>code.includes("approve")||code.includes("approval"))},
  {key:"notifications",icon:"bell",href:"/notifications",section:"navigation"},
  {key:"audit",icon:"shield",href:"/audit",section:"administration",permission:"audit.view"},
  {key:"company",icon:"building",href:"/admin/company",section:"administration",ownerOnly:true},
  {key:"users",icon:"users",href:"/admin/users",section:"administration",anyPermissions:["users.view","users.create","users.roles.manage"]},
  {key:"roles",icon:"settings",href:"/admin/roles",section:"administration",permission:"users.roles.manage"},
  {key:"account",icon:"user",href:"/account/sessions",section:"myAccount"},
 ],[permissions]);
 const visible=items.filter(item=>item.ownerOnly?owner:item.permission?permissions.includes(item.permission):item.anyPermissions?item.anyPermissions.some(permission=>permissions.includes(permission)):true);
 const primary:Array<[MobileNavKey,IconName,string]>=owner?[["home","home","/dashboard"],["operations","boxes","/operations"],["approvals","check","/approvals"],["reports","chart","/reports"]]:[["home","home","/dashboard"],["sales","receipt","/sales"],["production","factory","/production"],["loading","truck","/loading"]];
 const pathActive=primary.find(([key,,href])=>active===key||pathname===href||pathname.startsWith(`${href}/`));
 const primaryActive=pathActive??(owner&&["sales","production","loading","purchases","masters","payroll","accounting"].includes(active??"")?primary.find(([key])=>key==="operations"):undefined);
 const moreActive=!primaryActive;

 return <>
  {moreOpen&&!disabled&&<><button type="button" className="mobile-more-backdrop" aria-label={locale==="ta"?"மெனுவை மூடு":"Close menu"} onClick={()=>setMoreOpen(false)}/><section className="mobile-more-menu" role="dialog" aria-label={labels.more}><div className="mobile-more-heading"><b>{labels.more}</b><button type="button" onClick={()=>setMoreOpen(false)} aria-label={locale==="ta"?"மூடு":"Close"}>×</button></div>{(["navigation","administration","myAccount"] as const).map(section=>{const sectionItems=visible.filter(item=>item.section===section);return sectionItems.length?<div key={section} className="mobile-more-section"><div className="mobile-more-caption">{labels[section]}</div><div className="mobile-more-grid">{sectionItems.map(item=><a key={item.key} href={item.href} onClick={()=>setMoreOpen(false)}><Icon name={item.icon} size={18}/><span>{labels[item.key as keyof typeof labels]??item.key}</span></a>)}</div></div>:null})}</section></>}
  <nav className={`mobile-bottom-nav${disabled?" disabled":""}`} aria-label={locale==="ta"?"முதன்மை வழிசெலுத்தல்":"Main navigation"}>
   {primary.map(([key,icon,href])=>disabled?<span key={key} className={primaryActive?.[0]===key?"mobile-nav-item active":"mobile-nav-item"} aria-disabled="true"><Icon name={icon} size={19}/><span>{labels[key]}</span></span>:<a key={key} href={href} className={primaryActive?.[0]===key?"mobile-nav-item active":"mobile-nav-item"} aria-current={primaryActive?.[0]===key?"page":undefined}><Icon name={icon} size={19}/><span>{labels[key]}</span></a>)}
   <button type="button" className={`mobile-nav-item${moreActive||moreOpen?" active":""}`} aria-expanded={moreOpen} aria-haspopup="dialog" disabled={disabled} onClick={()=>setMoreOpen(value=>!value)}><Icon name="settings" size={19}/><span>{labels.more}</span></button>
  </nav>
 </>;
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
