# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-08-01
Run: automated Copilot routine (feature/WEB-AUTO-copilot-chat-orchestration-0801)

## Why this item was skipped

`McpClient.stream()` and `McpClientService` are the transport layer that opens
the actual SSE connection to the MCP server. Implementing them requires the
real wire contract: the endpoint path, the request payload shape sent to open
a stream, the exact SSE framing (event names, retry/reconnect semantics), auth
headers, and how a `tool_call` event is expected to be acknowledged or
resolved by the client.

None of that is documented anywhere in this repository (unchanged from prior
runs' findings):

- `src/app/copilot/services/mcp-fixtures.ts` is still an empty stub whose own
  comment says fixtures are "used for local development and unit tests so the
  UI can be built before the endpoint contract is finalised."
- `src/app/copilot/components/copilot-panel/copilot-panel.component.ts` still
  notes "the MCP server is not wired yet" and uses a mock reply "until the
  endpoint contract is finalised."
- No `docs/`, ADR, or markdown file in the repo describes the MCP SSE
  transport, tool-call acknowledgement flow, or the `/api/...` paths involved.
- `McpClientOptions.timeoutMs` / `maxRetries` are still annotated as
  "(proposal: ...)", i.e. not confirmed values.

Per the routine's instructions, writing a real `stream()` implementation
against a guessed wire format would be a risky, unverifiable action. This
item is skipped again for this run.

## What happened instead

Moved to the next unimplemented item: `services/chat.service.ts`
(orchestration + history). It only needs to call `McpClientService` through
its already-fully-typed method signature
(`sendMessage(...): Observable<McpStreamEvent>`) and does not need to know
the SSE wire format itself, so it can be built and unit-tested independently.

## Suggested next step for a human

Once the MCP server team documents (or the `mcp-fixtures.ts` file is
populated with real recorded responses from) the SSE event contract, a future
run can implement `McpClient.stream()` and `McpClientService` against it.
