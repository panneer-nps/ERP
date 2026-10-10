type PackageInput = { api: string; token: string; from: string; to: string; financialYearId?: string };
export type PackageRecord = { section: string; recordId: string; record: unknown };
type SectionResult = { name: string; status: "included" | "restricted" | "failed" | "truncated"; count: number; note: string };
type ArchiveFile = { name: string; bytes: Uint8Array };

const reportSources = [
  ["sales_register", "/api/reports/sales-register", { paymentStatus: "all" }],
  ["purchase_register", "/api/reports/purchases", { status: "all" }],
  ["expenses", "/api/expenses", {}],
  ["sales_invoices_and_receipts", "/api/sales/invoices", {}],
  ["customer_receipts", "/api/sales/on-account-receipts", {}],
  ["supplier_bills", "/api/purchases/bills", {}],
  ["stock_and_adjustments", "/api/reports/stock", {}],
  ["stocktakes", "/api/stocktakes", {}],
  ["production", "/api/reports/production", {}],
  ["loading_evidence_register", "/api/reports/loading", { status: "all" }],
  ["broker_ledger_and_commissions", "/api/reports/broker-commissions", { status: "all" }],
  ["customer_ledgers", "/api/sales/customer-balances", {}],
  ["supplier_ledgers", "/api/purchases/suppliers", {}],
  ["brokers", "/api/masters/brokers", {}],
  ["employees", "/api/employees", {}],
  ["employee_ledger", "/api/employee-advances", {}],
  ["employee_attendance", "/api/attendance", {}],
  ["payroll_runs", "/api/payroll/runs", {}],
  ["cash_book", "/api/accounting/cash-bank-book", { account: "1110" }],
  ["bank_book", "/api/accounting/cash-bank-book", { account: "1120" }],
  ["trial_balance", "/api/accounting/trial-balance", {}],
  ["profit_and_loss", "/api/accounting/profit-loss", {}],
  ["balance_sheet", "/api/accounting/balance-sheet", {}],
  ["approvals_pending", "/api/approvals", {}],
  ["cash_closings", "/api/accounting/cash-closings", {}],
  ["bank_reconciliations", "/api/accounting/bank-reconciliations", {}],
] as const;

function recordId(row: unknown, index: number) {
  if (row && typeof row === "object") {
    const value = row as Record<string, unknown>;
    for (const key of ["id", "number", "invoiceNumber", "billNumber", "expenseNumber", "batchNumber", "loadingNumber"]) {
      if (value[key] != null) return String(value[key]);
    }
  }
  return String(index + 1);
}

function extract(section: string, payload: unknown): PackageRecord[] {
  if (Array.isArray(payload)) return payload.map((record, i) => ({ section, recordId: recordId(record, i), record }));
  if (!payload || typeof payload !== "object") return [{ section, recordId: "summary", record: payload }];
  const object = payload as Record<string, unknown>;
  const arrays = Object.entries(object).filter(([, value]) => Array.isArray(value));
  if (!arrays.length) return [{ section, recordId: "summary", record: payload }];
  return arrays.flatMap(([key, rows]) => (rows as unknown[]).map((record, index) => ({ section: `${section}.${key}`, recordId: recordId(record, index), record })));
}

function withinDateRange(row: PackageRecord, from: string, to: string) {
  if (!row.record || typeof row.record !== "object") return true;
  const record = row.record as Record<string, unknown>;
  const keys = Object.keys(record);
  const periodStart = keys.find((key) => /period(start|from)|startsOn/i.test(key) && typeof record[key] === "string");
  const periodEnd = keys.find((key) => /period(end|to)|endsOn/i.test(key) && typeof record[key] === "string");
  if (periodStart && periodEnd) return (!to || String(record[periodStart]).slice(0, 10) <= to) && (!from || String(record[periodEnd]).slice(0, 10) >= from);
  const dateKey = Object.keys(record).find((key) => /date|(?:created|started|posted|paid|received|occurred|effective|captured|delivered|dispatched|verified|closed|attendance)at$|period(start|end|from|to)/i.test(key) && typeof record[key] === "string");
  if (!dateKey) return true;
  const date = String(record[dateKey]).slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

async function getJson(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (response.status === 401) window.location.replace("/");
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${response.status}`), { status: response.status });
  return body;
}

function rethrowUnauthorized(error: unknown): void {
  if ((error as { status?: number })?.status === 401) throw error;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: ArchiveFile[]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true); view.setUint32(14, checksum, true); view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true); view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    header.set(name, 30); local.push(header, file.bytes);
    const central = new Uint8Array(46 + name.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true); entry.setUint32(16, checksum, true);
    entry.setUint32(20, file.bytes.length, true); entry.setUint32(24, file.bytes.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); central.set(name, 46);
    directory.push(central); offset += header.length + file.bytes.length;
  }
  const centralSize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  const blobParts = [...local, ...directory, end].map((part) => part.slice().buffer as ArrayBuffer);
  return new Blob(blobParts, { type: "application/zip" });
}

function excelColumn(index: number) {
  let value = index + 1;
  let column = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function xmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

export function createAuditWorkbook(records: PackageRecord[]) {
  const grouped = new Map<string, PackageRecord[]>();
  for (const record of records) {
    const section = grouped.get(record.section);
    if (section) section.push(record);
    else grouped.set(record.section, [record]);
  }
  const usedNames = new Set<string>();
  const sheets = [...grouped.entries()].map(([section, rows], index) => {
    const baseName = (section.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || `Sheet ${index + 1}`);
    let name = baseName, suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      const tail = ` ${suffix++}`;
      name = `${baseName.slice(0, 31 - tail.length)}${tail}`;
    }
    usedNames.add(name.toLowerCase());
    return { name, rows };
  });
  const sheetXml = (rows: PackageRecord[]) => {
    const objects = rows.map((item) => ({ item, data: item.record && typeof item.record === "object" && !Array.isArray(item.record) ? item.record as Record<string, unknown> : { value: item.record } }));
    const fields = [...new Set(objects.flatMap(({ data }) => Object.keys(data)))];
    const splitValue = (value: unknown) => {
      const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
      const characters = Array.from(text);
      const chunks: string[] = [];
      for (let offset = 0; offset < characters.length; offset += 16_000) chunks.push(characters.slice(offset, offset + 16_000).join(""));
      return chunks.length ? chunks : [""];
    };
    const maxParts = new Map(fields.map((field) => [field, Math.max(1, ...objects.map(({ data }) => splitValue(data[field]).length))]));
    const columns = ["record_id", ...fields.flatMap((field) => [field, ...Array.from({ length: (maxParts.get(field) ?? 1) - 1 }, (_, index) => `${field} (part ${index + 2})`)])];
    const values: string[][] = [columns];
    for (const { item, data } of objects) {
      const row = [item.recordId];
      for (const field of fields) {
        const chunks = splitValue(data[field]);
        row.push(chunks[0] ?? "");
        for (let part = 1; part < (maxParts.get(field) ?? 1); part++) row.push(chunks[part] ?? "");
      }
      values.push(row);
    }
    const rowsXml = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  };
  const files: ArchiveFile[] = [
    { name: "[Content_Types].xml", bytes: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`) },
    { name: "_rels/.rels", bytes: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", bytes: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", bytes: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`) },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, bytes: new TextEncoder().encode(sheetXml(sheet.rows)) })),
  ];
  return zipStored(files);
}

export async function downloadAuditPackage({ api, token, from, to, financialYearId }: PackageInput) {
  const records: PackageRecord[] = [];
  const sections: SectionResult[] = [];
  let branchLabel = "Current permitted branch scope";
  try {
    const scope = await getJson(`${api}/api/auth/branches`, token) as { branches?: Array<{ id: string; name: string }>; currentBranchId?: string | null; canViewAll?: boolean };
    branchLabel = scope.canViewAll && !scope.currentBranchId ? "All company branches" : scope.branches?.find((branch) => branch.id === scope.currentBranchId)?.name ?? "Assigned branch scope";
  } catch { /* The report requests still enforce the session's branch scope. */ }

  await Promise.all(reportSources.map(async ([name, path, fixed]) => {
    const params = new URLSearchParams(fixed);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (name === "trial_balance" && financialYearId) params.set("financialYearId", financialYearId);
    try {
      const payload = await getJson(`${api}${path}?${params}`, token);
      const rows = extract(name, payload).filter((row) => withinDateRange(row, from, to));
      records.push(...rows);
      const declaredLimit = Number((payload as { limit?: unknown })?.limit);
      const hitLimit = Number.isFinite(declaredLimit) && declaredLimit > 0 && Object.values(payload as Record<string, unknown>).some((value) => Array.isArray(value) && value.length >= declaredLimit);
      sections.push({ name, status: hitLimit ? "truncated" : "included", count: rows.length, note: hitLimit ? `The API result reached its ${declaredLimit}-row limit; narrow the date range for a complete section.` : "Loaded using the authenticated API and current branch scope." });
    } catch (error) {
      rethrowUnauthorized(error);
      const status = (error as { status?: number }).status;
      sections.push({ name, status: status === 403 ? "restricted" : "failed", count: 0, note: error instanceof Error ? error.message : "Request failed." });
    }
  }));

  async function includeLedgers(sectionName: string, listSection: string, endpoint: string) {
    const entities = records.filter((record) => record.section === listSection && record.record && typeof record.record === "object");
    if (!entities.length) return;
    const target = entities.slice(0, 200);
    let failed = 0;
    for (let start = 0; start < target.length; start += 8) {
      const batch = await Promise.all(target.slice(start, start + 8).map(async (entity) => {
        const object = entity.record as Record<string, unknown>;
        try {
          const ledger = await getJson(`${api}${endpoint}/${encodeURIComponent(String(object.id))}/ledger`, token);
          const rows = extract(`${sectionName}.${entity.recordId}`, ledger).filter((row) => withinDateRange(row, from, to));
          return rows;
        } catch (error) { rethrowUnauthorized(error); failed++; return []; }
      }));
      records.push(...batch.flat());
    }
    const capped = entities.length > target.length;
    sections.push({ name: sectionName, status: capped ? "truncated" : failed ? "failed" : "included", count: target.length - failed, note: capped ? "Detailed ledgers are capped at 200 counterparties; narrow the scope or export individual ledgers." : failed ? `${failed} counterparty ledger request(s) failed or were restricted.` : "Counterparty ledger entries are filtered to the requested date range." });
  }
  await Promise.all([
    includeLedgers("customer_ledgers_detail", "customer_ledgers.customers", "/api/sales/customers"),
    includeLedgers("supplier_ledgers_detail", "supplier_ledgers.suppliers", "/api/purchases/suppliers"),
    includeLedgers("broker_ledgers_detail", "brokers.brokers", "/api/brokers"),
  ]);

  const payrollRuns = records.filter((record) => record.section === "payroll_runs.runs" && record.record && typeof record.record === "object");
  if (payrollRuns.length) {
    let failed = 0; const details: PackageRecord[] = [];
    for (let start = 0; start < Math.min(payrollRuns.length, 200); start += 8) {
      const batch = await Promise.all(payrollRuns.slice(start, start + 8).map(async (row) => {
        try {
          const run = row.record as Record<string, unknown>;
          return extract(`payroll_run_detail.${row.recordId}`, await getJson(`${api}/api/payroll/runs/${encodeURIComponent(String(run.id))}`, token)).filter((item) => withinDateRange(item, from, to));
        } catch (error) { rethrowUnauthorized(error); failed++; return []; }
      }));
      details.push(...batch.flat());
    }
    records.push(...details);
    sections.push({ name: "payroll_employee_lines", status: payrollRuns.length > 200 ? "truncated" : failed ? "failed" : "included", count: details.length, note: payrollRuns.length > 200 ? "Detailed payroll rows are capped at 200 salary runs." : failed ? `${failed} salary-run detail request(s) failed or were restricted.` : "Includes employee-level salary run lines." });
  }

  const loadingRows = records.filter((record) => record.section === "loading_evidence_register.rows" && record.record && typeof record.record === "object");
  const evidenceFiles: ArchiveFile[] = [];
  let evidenceBytes = 0;
  let evidenceStatus: SectionResult["status"] = "included";
  let evidenceNote = "Loading photos are included as original image files.";
  if (loadingRows.length) {
    let includedLoadingCount = 0;
    try {
      for (const row of loadingRows.slice(0, 100)) {
        const loading = row.record as Record<string, unknown>;
        const detail = await getJson(`${api}/api/loading/${encodeURIComponent(String(loading.id))}`, token) as { photos?: Array<Record<string, unknown>> };
        includedLoadingCount++;
        for (const photo of detail.photos ?? []) {
          const encoded = String(photo.imageBase64 ?? "");
          const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
          if (!bytes.length) continue;
          if (evidenceBytes + bytes.length > 15 * 1024 * 1024) { evidenceStatus = "truncated"; evidenceNote = "The 15 MB evidence-photo budget was reached; narrow the date range for all photos."; break; }
          const extension = photo.contentType === "image/png" ? "png" : photo.contentType === "image/webp" ? "webp" : "jpg";
          const filePath = `loading-evidence/${String(loading.loadingNumber ?? row.recordId)}/${String(photo.photoType ?? "photo")}-${String(photo.id ?? evidenceFiles.length + 1)}.${extension}`;
          evidenceFiles.push({ name: filePath, bytes }); evidenceBytes += bytes.length;
          const { imageBase64: _imageBase64, ...metadata } = photo;
          records.push({ section: "loading_photo_metadata", recordId: String(photo.id ?? evidenceFiles.length), record: { ...metadata, archivePath: filePath } });
        }
        if (evidenceStatus === "truncated") break;
      }
      if (loadingRows.length > 100 && evidenceStatus === "included") { evidenceStatus = "truncated"; evidenceNote = "Photo retrieval is capped at 100 loading sessions; narrow the date range for all photos."; }
      sections.push({ name: "loading_photo_files", status: evidenceStatus, count: evidenceFiles.length, note: evidenceNote });
      if (includedLoadingCount < loadingRows.length && evidenceStatus === "included") sections[sections.length - 1].status = "truncated";
    } catch (error) {
    rethrowUnauthorized(error);
      const status = (error as { status?: number }).status;
      sections.push({ name: "loading_photo_files", status: status === 403 ? "restricted" : "failed", count: evidenceFiles.length, note: error instanceof Error ? error.message : "Loading photo retrieval failed." });
    }
  } else sections.push({ name: "loading_photo_files", status: "included", count: 0, note: "No loading photos matched this date range." });

  const auditEvents: PackageRecord[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  let truncated = false;
  try {
    do {
      const params = new URLSearchParams({ limit: "200" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (cursor) { params.set("beforeAt", cursor.createdAt); params.set("beforeId", cursor.id); }
      const page = await getJson(`${api}/api/audit/logs?${params}`, token) as { events?: Array<Record<string, unknown>>; hasMore?: boolean; nextCursor?: { createdAt: string; id: string } | null };
      for (const event of page.events ?? []) auditEvents.push({ section: "audit_log", recordId: String(event.id ?? auditEvents.length + 1), record: event });
      cursor = page.nextCursor ?? null;
      if (!page.hasMore || !cursor) break;
      if (auditEvents.length >= 20000) { truncated = true; break; }
    } while (cursor);
    records.push(...auditEvents);
    const events = auditEvents.map((item) => item.record as Record<string, unknown>);
    const derived = [
      ["cancellations_and_reversals", (event: Record<string, unknown>) => /cancel|revers/i.test(String(event.action ?? ""))],
      ["adjustments", (event: Record<string, unknown>) => /adjust|journal|stocktake|valuation/i.test(`${event.action ?? ""} ${event.entityType ?? ""}`)],
      ["approval_history", (event: Record<string, unknown>) => /approv|reject|decision/i.test(String(event.action ?? ""))],
    ] as const;
    for (const [name, test] of derived) {
      const rows = events.filter(test).map((record, index) => ({ section: name, recordId: String(record.id ?? index + 1), record }));
      records.push(...rows);
      sections.push({ name, status: "included", count: rows.length, note: "Derived from the date-filtered audit log." });
    }
    sections.push({ name: "audit_log", status: truncated ? "truncated" : "included", count: auditEvents.length, note: truncated ? "Safety cap of 20,000 events reached; narrow the date range for a complete export." : "All available pages were loaded." });
  } catch (error) {
    rethrowUnauthorized(error);
    sections.push({ name: "audit_log", status: (error as { status?: number }).status === 403 ? "restricted" : "failed", count: 0, note: error instanceof Error ? error.message : "Request failed." });
  }

  const manifest = {
    package: "Brick Chamber ERP audit evidence",
    generatedAt: new Date().toISOString(),
    dateFrom: from || null,
    dateTo: to || null,
    financialYearId: financialYearId || null,
    branchScope: branchLabel,
    format: "ZIP containing a multi-sheet XLSX workbook, Excel-compatible CSV, manifest, and original loading photo files",
    sections,
  };
  records.unshift({ section: "manifest", recordId: "scope", record: manifest });
  const csvCell = (value: unknown) => {
    let text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = "\uFEFF" + [["section", "record_id", "record_json"], ...records.map((record) => [record.section, record.recordId, record.record])]
    .map((row) => row.map(csvCell).join(",")).join("\r\n");
  const excel = createAuditWorkbook(records);
  const files: ArchiveFile[] = [
    { name: "audit-package.csv", bytes: new TextEncoder().encode(csv) },
    { name: "audit-package.xlsx", bytes: new Uint8Array(await excel.arrayBuffer()) },
    { name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    ...evidenceFiles,
  ];
  const url = URL.createObjectURL(zipStored(files));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `brick-chamber-audit-package-${to || from || new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { sections, complete: sections.every((section) => section.status === "included") };
}
