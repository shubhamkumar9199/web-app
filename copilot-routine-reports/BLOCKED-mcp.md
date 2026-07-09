# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-09

## Reason

Item 4 in the roadmap (implement the SSE transport in `core/mcp-client.ts`
and the Angular wrapper in `services/mcp-client.service.ts`) is skipped for
this run because the MCP server's SSE / tool-call wire contract is not
documented anywhere in the repository.

Evidence:

- `src/app/copilot/services/mcp-fixtures.ts` contains only a TODO and an
  empty fixture map, with the comment: "Used for local development and
  unit tests so the UI can be built before the endpoint contract is
  finalised."
- `src/app/copilot/core/mcp-client.ts` and
  `src/app/copilot/core/models/mcp-response.model.ts` define a plausible
  `McpStreamEvent` shape (`token` / `tool_call` / `action_card` / `done` /
  `error`), but there is no spec for:
  - the actual SSE endpoint path/method,
  - authentication headers,
  - the exact `data:` payload JSON shape sent by the server,
  - reconnection/backoff semantics expected by the server, or
  - how tool-call confirmation results are sent back upstream.
- No design doc, ADR, or contract file exists under `src/app/copilot/` or
  elsewhere in the repo describing this.

Implementing the transport now would mean guessing the wire format, which
risks building against a contract that doesn't match the real MCP server.
Per the routine's rules, this item is skipped rather than guessed.

## Next steps

Move to item 5 (`services/chat.service.ts`) for this run. Re-attempt item 4
once the MCP server contract (SSE event schema, auth, endpoint) is
documented in the repo, e.g. in `mcp-fixtures.ts` or a new contract doc.
