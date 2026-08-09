# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-08-09
Run: automated Copilot routine

## Why this item was skipped

Roadmap item 4 (`core/mcp-client.ts` + `services/mcp-client.service.ts`, SSE
transport) requires a documented SSE/tool-call contract with the MCP server.
The repo does not have one yet:

- `core/mcp-client.ts` options are annotated as `(proposal: 15s)` and
  `(proposal: 3)` for timeout/retry, i.e. not finalized values.
- `services/mcp-fixtures.ts` is an empty stub with the comment "so the UI
  can be built before the endpoint contract is finalised" and a TODO to
  "paste 5-10 recorded responses" that has not been done.
- No markdown docs, OpenAPI spec, or design doc describing the SSE event
  shape, tool-call routing, or auth flow were found anywhere in the repo
  (searched for `mcp` across `*.md` and file names outside
  `src/app/copilot`).

`core/models/mcp-response.model.ts` defines a plausible `McpStreamEvent`
shape, but a model file alone is not a contract from the server team -
implementing the transport against it now risks building against numbers
and framing invented locally rather than agreed upstream.

## Action taken

Per the run's instructions, this item was skipped and the routine moved to
the next roadmap item (item 5: `services/chat.service.ts`).

## Recommendation

Once the MCP server team documents/finalizes the SSE contract (event
shapes, retry/timeout values, auth), a future run can implement
`core/mcp-client.ts` and `services/mcp-client.service.ts` directly against
it, and populate `services/mcp-fixtures.ts` with real recorded responses.
