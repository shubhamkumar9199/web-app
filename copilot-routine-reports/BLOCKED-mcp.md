# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-07

Roadmap item 4 (the SSE transport: `core/mcp-client.ts` and
`services/mcp-client.service.ts`) was evaluated and skipped again this run.
The SSE/tool-call wire contract is still not documented anywhere in the
repository:

- `services/mcp-fixtures.ts` is an empty stub with a TODO ("paste 5-10
  recorded responses ... before the endpoint contract is finalised"), i.e.
  no real server responses have been captured.
- `components/copilot-panel/copilot-panel.component.ts` explicitly notes
  "the MCP server is not wired yet" and uses a mock reply, to be swapped for
  `ChatService` "once the endpoint contract is finalised".
- Nothing in the repo specifies the actual HTTP method/endpoint path, auth
  headers, or raw SSE frame format the Mifos MCP server sends. The
  `McpStreamEvent`/`McpResponse` TypeScript interfaces describe an aspirational
  client-side shape, not a confirmed wire contract, and `stream()`'s payload
  (message + context + idempotencyKey) doesn't fit a plain `EventSource`
  (GET-only), so even the transport mechanism is ambiguous.

Per the routine's instructions, this item is skipped rather than guessed at,
to avoid shipping a transport implementation against an invented contract
that would need to be thrown away once the real MCP server contract lands.

Moved on to roadmap item 5 (`services/chat.service.ts`) instead, since it
only depends on the already-typed public API of `McpClientService`
(`sendMessage(): Observable<McpStreamEvent>`, `handleToolCall()`), not on the
underlying wire format.

No code changes were made for this item.
