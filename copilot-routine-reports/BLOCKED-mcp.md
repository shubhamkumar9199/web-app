# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-05

## Why this item was skipped

Roadmap item 4 asks for an implementation of the MCP SSE transport
(`core/mcp-client.ts` `McpClient.stream()`) and its Angular wrapper
(`services/mcp-client.service.ts` `sendMessage()` / `handleToolCall()`).

Before implementing a network transport, the actual wire contract needs to be
fixed: the endpoint path, whether the stream is opened via a native
`EventSource` (GET only) or a fetch-based SSE polyfill (needed if the request
carries a JSON body such as `message`/`context`/`idempotencyKey`), auth/header
requirements, the exact SSE `data:` framing for each `McpStreamEventType`, and
the retry/backoff behavior on the wire (not just the proposed defaults noted
in comments).

Searched the repository for this contract and found none of it documented:

- No `docs/` entry mentions MCP, SSE, or the copilot backend contract
  (`docs/` only has `analytics.md`, `routing.md`, `i18n.md`, `updating.md`,
  `backend-proxy.md`, `corporate-proxy.md`, `coding-guides/*`).
- No README/markdown file exists under `src/app/copilot`.
- `core/models/mcp-response.model.ts` defines the in-memory event shape
  (`McpStreamEventType`, `McpStreamEvent`, `McpResponse`) but says nothing
  about the transport itself.
- `core/mcp-client.ts` and `services/mcp-client.service.ts` only have
  `// TODO` comments with proposed timeout/retry numbers ("proposal: 15s",
  "proposal: 3") — explicitly marked as proposals, not a fixed contract.
- No environment config (`src/environments/*`) references an MCP base URL.
- `services/mcp-fixtures.ts` provides fixture data for UI development but
  does not describe the live wire protocol.

Per the run's instructions, this item is skipped rather than guessed at, since
inventing endpoint paths/framing now would likely have to be thrown away (or
worse, silently diverge from whatever the real MCP server expects) once the
contract is actually specified.

## Recommendation

Before this item can be picked up, someone with access to the MCP server
design needs to add a short contract doc (e.g. `docs/copilot-mcp-contract.md`
or a comment block in `core/mcp-client.ts`) covering:

1. Endpoint URL/path and HTTP method.
2. Request framing (query params vs. JSON body) and whether a fetch-based SSE
   client is required instead of native `EventSource`.
3. Auth headers, if any.
4. Exact `data:` payload shape per `McpStreamEventType`.
5. Confirmed timeout and retry/backoff values.

## What happened instead

Moved to roadmap item 5 (`services/chat.service.ts`) for this run.
