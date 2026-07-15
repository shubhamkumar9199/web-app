# Skipped: core/mcp-client.ts + services/mcp-client.service.ts (SSE)

Date: 2026-07-15

## Why this item was skipped

Roadmap item 4 (MCP SSE transport) requires a documented request/response and
tool-call contract from the Mifos MCP server. Checked the repo for that
contract and did not find one:

- `core/mcp-client.ts` only has inline comments marked "proposal" (15s
  timeout, 3 retries) with no reference to a spec.
- `services/mcp-fixtures.ts` is an empty stub: "TODO: paste 5-10 recorded
  responses (client lookup, loan view, etc.)." with zero entries.
- No markdown docs, OpenAPI/AsyncAPI spec, or SSE event schema describing the
  actual wire format exist anywhere under the repo (searched for `MCP`, `SSE`,
  `EventSource` across `*.md` and `src/app/copilot`).

Without recorded fixtures or a written contract, an SSE client implementation
here would be guesswork: framing, event names/ordering, error/retry
semantics, and backoff behavior can't be verified against anything real, and
a Jest spec built against invented fixtures would not catch a mismatch with
the actual server.

## What was done instead

Per instructions, moved to the next roadmap item: `services/chat.service.ts`
(orchestration + history). That implementation still depends on
`McpClientService` for the actual network call, so it consumes it as an
injected collaborator (mocked in `chat.service.spec.ts`) rather than
implementing the transport itself. `mcp-client.ts` and `mcp-client.service.ts`
are left untouched with their `Not implemented` stubs.

## Follow-up needed

Someone with access to the MCP server's actual SSE contract (or a captured
HAR/log of a real session) needs to populate `mcp-fixtures.ts` and document
the event schema before item 4 can be implemented safely.
