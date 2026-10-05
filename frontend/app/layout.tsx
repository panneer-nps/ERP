import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "./i18n";
import "./styles.css";

export const metadata: Metadata = {
  title: "Brick Chamber ERP",
  description: "Operations and finance management for brick chamber businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><LocaleProvider>{children}</LocaleProvider></body></html>;
}
