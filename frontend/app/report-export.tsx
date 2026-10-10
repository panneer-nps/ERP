"use client";

import { Icon } from "./visuals";
import type { ReactNode } from "react";

export function ReportPrintButton({ label }: { label: string }) {
  function printReport() {
    const heading = document.querySelector<HTMLElement>(".dashboard-content .master-heading");
    let generatedMeta: HTMLParagraphElement | null = null;
    if (heading && !heading.querySelector(".report-print-meta")) {
      const filters = [...document.querySelectorAll<HTMLLabelElement>(".report-filter label")].map((label) => {
        const field = label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
        const caption = label.cloneNode(true) as HTMLLabelElement;
        caption.querySelectorAll("input, select, textarea").forEach((element) => element.remove());
        const name = caption.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const value = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent?.trim() : field?.value;
        return name && value ? `${name}: ${value}` : "";
      }).filter(Boolean);
      if (filters.length) {
        generatedMeta = document.createElement("p");
        generatedMeta.className = "report-print-meta report-print-generated-meta";
        generatedMeta.textContent = filters.join(" · ");
        heading.appendChild(generatedMeta);
      }
    }
    const oldTitle = document.title;
    const reportTitle = heading?.querySelector("h1")?.textContent?.trim();
    if (reportTitle) document.title = `${reportTitle} - Brick Chamber ERP`;
    document.body.classList.add("report-print-mode");
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("report-print-mode");
      generatedMeta?.remove();
      document.title = oldTitle;
    }, { once: true });
    window.print();
  }

  return <button type="button" className="master-add report-print-trigger" onClick={printReport}><Icon name="receipt" size={17}/>{label}</button>;
}

export function ReportPrintMeta({ children }: { children: ReactNode }) {
  return <p className="report-print-meta">{children}</p>;
}
