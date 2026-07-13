# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-13

## Why this item is blocked

Item 4 on the Copilot roadmap (`core/mcp-client.ts` and
`services/mcp-client.service.ts`) requires implementing an SSE transport
against the MCP server, but the SSE / tool-call contract is not documented
anywhere in this repository:

- `src/app/copilot/services/mcp-fixtures.ts` is an empty stub whose own
  comment says fixtures are "TODO: paste 5-10 recorded responses" and that
  it exists "so the UI can be built before the endpoint contract is
  finalised" - i.e. the author explicitly flagged the contract as not yet
  final.
- There is no base URL, auth header, or request/response shape documented
  for the MCP endpoint anywhere in the repo (checked all `*.md` files,
  `README.md`, `CONTRIBUTING.md` - no mentions of MCP transport details).
- `src/app/copilot/core/models/mcp-response.model.ts` defines the
  `McpStreamEvent` shape (`token` / `tool_call` / `action_card` / `done` /
  `error`), but nothing specifies: the endpoint path/method used to open
  the stream, how a POST body (the chat message + context) is supplied to
  an `EventSource`-based transport (native `EventSource` only supports
  GET), the idempotency-key header/param name, or the retry/backoff
  behavior expected from the server vs. the client.
- `mcp-client.ts` and `mcp-client.service.ts` both still throw
  `Not implemented`, with comments referencing a "proposal" for timeout
  (15s) and retries (3) rather than a finalized spec.

Implementing this now would mean guessing transport details (auth,
request framing, backoff semantics) that would likely need to be redone
once the real contract lands, so per the routine's rules this item is
skipped for this run.

## What happened instead

Moved on to item 5, `services/chat.service.ts` (orchestration + history),
which does not depend on the unresolved MCP transport contract for its
Jest-testable surface.

## Suggested follow-up

Once the MCP server team documents the SSE contract (endpoint, auth,
request framing for POST-style payloads, idempotency header, retry
semantics), re-attempt item 4 and backfill `mcp-fixtures.ts` with real
recorded responses.
