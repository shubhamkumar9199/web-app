# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-29
Run: automated Copilot routine (feature/WEB-AUTO-copilot-chat-service)

## Why this item was skipped

`McpClient.stream()` and `McpClientService` are the transport layer that opens
the actual SSE connection to the MCP server. Implementing them requires the
real wire contract: the endpoint path, the request payload shape sent to open
a stream, the exact SSE framing (event names, retry/reconnect semantics), auth
headers, and how a `tool_call` event is expected to be acknowledged or
resolved by the client.

None of that is documented anywhere in this repository:

- `src/app/copilot/services/mcp-fixtures.ts` is an empty stub whose own
  comment says fixtures are "used for local development and unit tests so the
  UI can be built before the endpoint contract is finalised."
- `src/app/copilot/components/copilot-panel/copilot-panel.component.ts` notes
  "the MCP server is not wired yet" and uses a mock reply "until the endpoint
  contract is finalised."
- No `docs/`, ADR, or markdown file in the repo describes the MCP SSE
  transport, tool-call acknowledgement flow, or the `/api/...` paths involved.
- `McpClientOptions.timeoutMs` / `maxRetries` are annotated as "(proposal:
  ...)", i.e. not confirmed values.

Per the routine's instructions, writing a real `stream()` implementation
against a guessed wire format would be a risky, unverifiable action (it could
silently ship a client that never matches the real server). This item is
skipped for this run.

## What happened instead

Moved to the next item in the priority list: `services/chat.service.ts`
(orchestration + history), which only needs to call `McpClientService` through
its already-fully-typed method signature (`sendMessage(...): Observable<McpStreamEvent>`)
and does not need to know the SSE wire format itself.

## Suggested next step for a human

Get the actual MCP server SSE contract documented (endpoint, payload, event
framing, auth, tool-call ack flow) in the repo, e.g. under `docs/copilot/`, so
a future automated or manual pass can implement `McpClient.stream()` against a
real spec instead of guessing.
