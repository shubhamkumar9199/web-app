# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-11

## Why this item is blocked

Roadmap item 4 (the SSE/tool-call transport: `core/mcp-client.ts` and
`services/mcp-client.service.ts`) requires a documented contract for the live
MCP server endpoint: base URL, auth headers, SSE event framing, and the
retry/backoff behaviour expected by the server. This is not documented
anywhere in the repository.

Evidence that the contract is still open, found in the codebase itself:

- `src/app/copilot/services/mcp-fixtures.ts`: "Recorded MCP response fixtures
  captured from the live server during community bonding. Used for local
  development and unit tests so the UI can be built **before the endpoint
  contract is finalised**." The fixture map itself is still empty
  (`// TODO: paste 5-10 recorded responses`).
- `src/app/copilot/components/copilot-panel/copilot-panel.component.ts`:
  "NOTE: the MCP server is not wired yet ... Swap in ChatService once **the
  endpoint contract is finalised**."
- `src/app/copilot/core/mcp-client.ts`: `McpClientOptions.timeoutMs` and
  `maxRetries` are both marked "(proposal: ...)", i.e. not agreed values.
- Prior commit `365cc18b3` ("Add Copilot core services and confirmation
  dialog") explicitly deferred this: "No MCP wiring yet; that follows once
  the server contract is finalized."

Per the routine's instructions, this item is skipped rather than guessed at,
since implementing the real `EventSource`/fetch-based SSE parsing against an
undocumented wire format would be pure speculation and likely wrong once the
real contract lands.

## What moved forward instead

Roadmap item 5, `services/chat.service.ts`, was implemented this run. It
orchestrates against `McpClientService`'s already-defined TypeScript
interface (`sendMessage(...): Observable<McpStreamEvent>`,
`handleToolCall(event)`), which is a contract already documented in this
repo via `core/models/mcp-response.model.ts`, independent of whether the
underlying transport is wired up yet. The Jest spec for `ChatService`
injects a fake `McpClientService` so the orchestration logic (sanitize ->
stream -> parse -> persist) is fully covered without depending on the real
backend.

## Next step

Once the MCP server team publishes the endpoint contract (URL, auth, SSE
event shape, retry policy), pick up `core/mcp-client.ts` and
`services/mcp-client.service.ts` next - at that point `ChatService` should
need no changes, since it already codes against the service's public
interface.
