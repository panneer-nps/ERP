import assert from "node:assert/strict";
import { createAuditWorkbook } from "../app/audit/audit-package";

async function main() {
const input = [
  { section: "sales/orders", recordId: "INV-001", record: { customer: "தமிழ் & Sons", note: "<verified>", formulaLike: "=HYPERLINK(\"https://example.invalid\")" } },
  { section: "sales/orders", recordId: "INV-002", record: { value: "x".repeat(30_001) } },
  { section: "sales:orders", recordId: "INV-003", record: { value: 3 } },
];
const archive = new Uint8Array(await createAuditWorkbook(input).arrayBuffer());
const decoder = new TextDecoder();
const files = new Map<string, string>();
let offset = 0;
while (offset + 30 <= archive.length) {
  const view = new DataView(archive.buffer, archive.byteOffset + offset);
  if (view.getUint32(0, true) !== 0x04034b50) break;
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const nameStart = offset + 30;
  const dataStart = nameStart + nameLength + extraLength;
  const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
  files.set(name, decoder.decode(archive.subarray(dataStart, dataStart + size)));
  offset = dataStart + size;
}

assert(files.has("[Content_Types].xml"));
assert(files.has("_rels/.rels"));
assert(files.has("xl/workbook.xml"));
assert(files.has("xl/worksheets/sheet1.xml"));
assert(files.has("xl/worksheets/sheet2.xml"));
const workbookXml = files.get("xl/workbook.xml")!;
assert.match(workbookXml, /<sheets>/);
const firstSheet = files.get("xl/worksheets/sheet1.xml")!;
assert.match(firstSheet, /தமிழ் &amp; Sons/);
assert.match(firstSheet, /&lt;verified&gt;/);
assert.match(firstSheet, /=HYPERLINK/);
assert.match(firstSheet, /customer/);
assert.match(firstSheet, /value \(part 2\)/);
assert.doesNotMatch(firstSheet, /<f[ >]/i);
const secondSheet = files.get("xl/worksheets/sheet2.xml")!;
assert.match(secondSheet, /INV-003/);
console.log("Audit workbook verifier passed: OpenXML package layout, separate section tabs, field columns, Unicode/XML escaping, formula-safe text, and long-cell continuation columns.");
}

void main();
