import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "./i18n";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./styles.css";

export const metadata: Metadata = {
  title: "Brick Chamber ERP",
  description: "Operations and finance management for brick chamber businesses.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#263f30" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><LocaleProvider><ServiceWorkerRegistration />{children}</LocaleProvider></body></html>;
}
