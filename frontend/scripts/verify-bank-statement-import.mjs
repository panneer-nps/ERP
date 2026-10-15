import assert from "node:assert/strict";
import { parseBankStatementCsv } from "../app/bank-statement-import.ts";

const indianBankExport = [
  "Account statement generated on 03-10-2026",
  "Account Number,XXXXXX1234",
  "Tran Date,Particulars,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Balance",
  '01-10-2026,"UPI, tea shop",UPI-REF-101,"1,250.00",,"8,750.00"',
  '02 Oct 2026,NEFT customer receipt,NEFT-202,,"24,500.00","33,250.00"',
].join("\r\n");

const imported = parseBankStatementCsv(indianBankExport);
assert.deepEqual(imported, [
  { date: "2026-10-01", description: "UPI, tea shop", reference: "UPI-REF-101", amount: -1250 },
  { date: "2026-10-02", description: "NEFT customer receipt", reference: "NEFT-202", amount: 24500 },
]);

const signedAmounts = parseBankStatementCsv([
  "Transaction Date,Narration,UTR,Amount",
  "2026-10-03,IMPS debit,TX-3,125.50DR",
  '04/10/2026,Cheque return,CHQ-4,"(200.25)"',
  "05/10/2026,Interest credit,INT-5,15.75CR",
].join("\n"));
assert.deepEqual(signedAmounts.map(line => line.amount), [-125.5, -200.25, 15.75]);

const semicolonExport = parseBankStatementCsv([
  "Value Date;Narration;Instrument No.;Debit;Credit",
  "2026-10-06;Cash withdrawal;ATM-6;500;",
  "2026-10-07;Cash deposit;DEP-7;;2,000",
].join("\n"));
assert.deepEqual(semicolonExport.map(line => [line.reference, line.amount]), [["ATM-6", -500], ["DEP-7", 2000]]);

assert.throws(() => parseBankStatementCsv([
  "Date,Description,Withdrawal Amt.,Deposit Amt.",
  "01/10/2026,Ambiguous row,10,20",
].join("\n")), /either a debit or a credit/);
assert.throws(() => parseBankStatementCsv([
  "Date,Description,Withdrawal Amt.",
  '01/10/2026,"Unclosed description,10',
].join("\n")), /Unclosed quoted CSV field/);

console.log(JSON.stringify({ passed: true, indianBankHeader: true, debitCreditSigns: true, signedAmounts: true, semicolonDelimiter: true, invalidRowsRejected: true }));
