# Skipped: core/mcp-client.ts + services/mcp-client.service.ts (SSE)

Date: 2026-07-17

## Why this item was skipped

Roadmap item 4 (MCP SSE transport) requires a documented request/response and
tool-call contract from the Mifos MCP server. Checked the repo for that
contract and did not find one:

- `core/mcp-client.ts` only has inline comments marked "proposal" (15s
  timeout, 3 retries) with no reference to a spec.
- `services/mcp-fixtures.ts` is an empty stub: "TODO: paste 5-10 recorded
  responses (client lookup, loan view, etc.)." with zero entries.
- `copilot-panel.component.ts` explicitly says: "the MCP server is not wired
  yet... Swap in ChatService once the endpoint contract is finalised."
- No markdown docs, OpenAPI/AsyncAPI spec, or SSE event schema describing the
  actual wire format exist anywhere under the repo.

This is the same conclusion prior runs reached (see git history on
`feature/WEB-AUTO-copilot-chat-orchestration`, dated 2026-07-15). Nothing
about the contract's documentation status has changed since then.

## Follow-up needed

Someone with access to the MCP server's actual SSE contract (or a captured
HAR/log of a real session) needs to populate `mcp-fixtures.ts` and document
the event schema before item 4 can be implemented safely.
