# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-08-05
Run: automated Copilot roadmap routine

## Why this item was skipped

Roadmap item 4 (SSE-based MCP client) was skipped this run because the
SSE / tool-call contract with the MCP server is not documented in the
repository. Evidence, all found under `src/app/copilot`:

- `services/mcp-fixtures.ts` states directly: "Used for local development
  and unit tests so the UI can be built before the endpoint contract is
  finalised" and ships an empty fixture map with a `// TODO: paste 5-10
recorded responses` placeholder — no real recorded payloads exist to
  verify field shapes against.
- `core/mcp-client.ts` and `services/mcp-client.service.ts` both contain
  `throw new Error('Not implemented')` bodies with comments marking the
  timeout (`15s`) and retry count (`3`) as a "proposal", not a confirmed
  value.
- `components/copilot-panel/copilot-panel.component.ts` explicitly notes:
  "the MCP server is not wired yet - sendMessage() currently produces a
  mock assistant reply so the UI is demoable. Swap in ChatService once the
  endpoint contract is finalised."

Implementing the SSE transport now would mean guessing event framing,
error semantics, and retry/backoff behavior against an unconfirmed
contract, which risks baking in assumptions that have to be reworked once
the real MCP server contract lands.

## What happened instead

Moved to the next roadmap item per the routine's fallback rule:
`services/chat.service.ts` (orchestration + history). See the PR from this
run for that implementation.

## Suggested follow-up

Skip this item again on future runs until one of the following lands in
the repo:

- Recorded fixtures in `services/mcp-fixtures.ts` (real payloads, not the
  empty placeholder), or
- A written SSE contract doc (event types, error shape, retry contract)
  referenced from `core/mcp-client.ts`.
