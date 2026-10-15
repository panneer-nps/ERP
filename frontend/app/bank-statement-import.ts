export type ImportedBankLine = { date: string; description: string; reference: string; amount: number };

const aliases = {
  date: ["date", "transactiondate", "trandate", "valuedate", "postingdate", "txndate", "transactiondt", "valuedt", "valdt", "txndt"],
  description: ["description", "narration", "narrative", "particulars", "transactiondetails", "details", "remarks", "transactionnarration"],
  reference: ["reference", "ref", "refno", "referenceno", "chequerefno", "chqrefno", "chqno", "chequeno", "chequenumber", "instrumentno", "instrno", "utr", "utrno", "transactionid", "txnid", "documentnumber"],
  amount: ["amount", "amountinr", "transactionamount", "transactionamountinr", "txnamount", "signedamount"],
  debit: ["debit", "debitdr", "debitamt", "debitamount", "withdrawal", "withdrawals", "withdrawaldr", "withdraw", "withdrawalamnt", "withdrawalamt", "withdrawalamount", "withdrawalamountinr"],
  credit: ["credit", "creditcr", "creditamt", "creditamount", "deposit", "deposits", "depositcr", "depositamt", "depositamount", "depositamnt", "depositamountinr"],
} as const;

function normalizeHeader(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dateParts(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(raw: string) {
  const value = raw.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (match) return dateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(value);
  if (match) return dateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const year = Number(match[3].length === 2 ? `${Number(match[3]) < 70 ? "20" : "19"}${match[3]}` : match[3]);
    return dateParts(year, Number(match[2]), Number(match[1]));
  }
  match = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ,]+(\d{2}|\d{4})$/.exec(value);
  if (match) {
    const month = new Date(`${match[2]} 1, 2000`).getMonth() + 1;
    const year = Number(match[3].length === 2 ? `${Number(match[3]) < 70 ? "20" : "19"}${match[3]}` : match[3]);
    if (month > 0) return dateParts(year, month, Number(match[1]));
  }
  match = /^([A-Za-z]{3,9})[ ]+(\d{1,2}),?[ ]+(\d{4})$/.exec(value);
  if (match) {
    const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
    if (month > 0) return dateParts(Number(match[3]), month, Number(match[2]));
  }
  return null;
}

function amountValue(raw: string) {
  let value = raw.trim().replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  if (!value) return 0;
  const parens = value.startsWith("(") && value.endsWith(")");
  if (parens) value = value.slice(1, -1);
  const suffix = /(DR|CR)$/i.exec(value)?.[1]?.toUpperCase();
  if (suffix) value = value.slice(0, -2);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return NaN;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  if (parens || suffix === "DR") return -Math.abs(amount);
  if (suffix === "CR") return Math.abs(amount);
  return amount;
}

function parseRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell.length) throw new Error("Malformed quoted CSV field.");
      quoted = true;
    } else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseBankStatementCsv(text: string): ImportedBankLine[] {
  const samples = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(line=>line.trim()).slice(0,10);
  const delimiters=[",",";","\t"];
  const headerCandidate=(line:string,delimiter:string)=>{
    const columns=line.split(delimiter).map(normalizeHeader),has=(names:readonly string[])=>columns.some(value=>names.includes(value));
    return has(aliases.date)&&has(aliases.description)&&(has(aliases.amount)||has(aliases.debit)||has(aliases.credit));
  };
  const matching=delimiters.map(value=>({value,index:samples.findIndex(line=>headerCandidate(line,value)),count:Math.max(0,...samples.map(line=>line.split(value).length-1))})).filter(candidate=>candidate.index>=0).sort((a,b)=>a.index-b.index||b.count-a.count);
  const delimiter=matching[0]?.value??delimiters.map(value=>({value,count:Math.max(0,...samples.map(line=>line.split(value).length-1))})).sort((a,b)=>b.count-a.count)[0].value;
  const rows = parseRows(text, delimiter);
  if (rows.length < 2) throw new Error("The CSV has no transaction rows.");
  const headerRowIndex = rows.slice(0,10).findIndex(candidate=>{
    const candidateHeader=candidate.map(normalizeHeader),has=(names:readonly string[])=>candidateHeader.some(value=>names.includes(value));
    return has(aliases.date)&&has(aliases.description)&&(has(aliases.amount)||has(aliases.debit)||has(aliases.credit));
  });
  if(headerRowIndex<0)throw new Error("Could not identify the statement header row.");
  const header = rows[headerRowIndex].map(normalizeHeader);
  rows.splice(0,headerRowIndex+1);
  const find = (names: readonly string[]) => header.findIndex(value => names.includes(value));
  const dateIndex = find(aliases.date), descriptionIndex = find(aliases.description), referenceIndex = find(aliases.reference);
  const amountIndex = find(aliases.amount), debitIndex = find(aliases.debit), creditIndex = find(aliases.credit);
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error("Could not identify date, description, and amount columns.");
  }
  const parsed: ImportedBankLine[] = [];
  for (const values of rows) {
    if (!values.some(value => value.trim())) continue;
    const date = parseDate(values[dateIndex] ?? "");
    const description = (values[descriptionIndex] ?? "").trim();
    if (!date || !description) throw new Error("Each transaction needs a valid date and description.");
    let amount: number;
    if (amountIndex >= 0) amount = amountValue(values[amountIndex] ?? "");
    else {
      const debit = debitIndex >= 0 ? amountValue(values[debitIndex] ?? "") : 0;
      const credit = creditIndex >= 0 ? amountValue(values[creditIndex] ?? "") : 0;
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || (debit !== 0 && credit !== 0)) throw new Error("Use either a debit or a credit amount on each row, not both.");
      amount = Math.abs(credit) - Math.abs(debit);
    }
    if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999_999) throw new Error("A transaction amount is invalid or too large.");
    if (amount === 0) continue;
    parsed.push({ date, description, reference: referenceIndex >= 0 ? (values[referenceIndex] ?? "").trim().slice(0, 160) : "", amount: Number(amount.toFixed(2)) });
    if (parsed.length > 5000) throw new Error("A statement import can include at most 5,000 transaction rows.");
  }
  if (!parsed.length) throw new Error("The CSV has no non-zero transaction rows.");
  return parsed;
}
