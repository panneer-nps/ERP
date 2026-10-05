"use client";
import { useLocale } from "./i18n";
import { Icon, type IconName } from "./visuals";

export function MobileNavigation({active}:{active:"home"|"masters"|"production"|"sales"|"loading"|"purchases"}){
 const {locale}=useLocale();const labels=locale==="ta"?{home:"முகப்பு",masters:"அடிப்படை",production:"உற்பத்தி",sales:"விற்பனை",loading:"விநியோகம்",purchases:"கொள்முதல்"}:{home:"Home",masters:"Masters",production:"Production",sales:"Sales",loading:"Delivery",purchases:"Purchases"};
 const items:Array<[typeof active,IconName,string]>=[["home","home","/dashboard"],["masters","boxes","/masters"],["production","factory","/production"],["sales","chart","/sales"],["purchases","shopping","/purchases"],["loading","truck","/loading"]];
 return <nav className="mobile-bottom-nav" aria-label={locale==="ta"?"முதன்மை வழிசெலுத்தல்":"Main navigation"}>{items.map(([key,icon,href])=><a key={key} href={href} className={active===key?"mobile-nav-item active":"mobile-nav-item"} aria-current={active===key?"page":undefined}><Icon name={icon} size={19}/><span>{labels[key]}</span></a>)}</nav>;
}



