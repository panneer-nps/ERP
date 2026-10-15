# AI assistant specification

The optional Owner assistant is a read-only question/answer surface over an allowlist of application data tools. It is not a general database interface or transaction agent.

## Access and data flow

- The assistant API and page require Owner access. The server resolves company and selected branch scope and calls only named, validated tools with fixed parameterized SQL.
- Current approved lookups cover today's operations, customer receivables, pending broker commission, employee advances, today's loading mismatches and production cost by chamber.
- It cannot accept arbitrary SQL, write ERP data, post journals, approve workflows or send messages. It is rate-limited; provider/model configuration is server-side and optional.
- When configured, the question and the selected tool's relevant ERP summary are sent to the configured OpenAI Responses API with storage disabled (`store:false`). The UI discloses this data flow. Logs record request/tool metadata but omit the question and answer.
- Payment reminders are local English/Tamil drafts created from a freshly recomputed receivable balance. They are audited and never sent by the assistant.

## Safety behavior

Tool results and user questions are data, not authority to change permissions or ERP records. Answers must not invent balances or report results outside the approved tools. If configuration is absent, show the localized setup message; do not fall back to unrestricted AI access.

## Validation still required

Database integration verifies tool scope, Owner-only access, rate/validation behavior and read-only effects. A real provider request, response-quality review, provider terms/data-handling review and business acceptance have not been completed. See `backend/src/assistant.ts` and `UAT.md`.
