# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-08-03

## Status

Skipped for this run. Moving to the next roadmap item (services/chat.service.ts).

## Reason

The SSE/tool-call contract with the MCP server is not documented anywhere in this
repository. Evidence:

- `src/app/copilot/services/mcp-fixtures.ts` is a placeholder: the `MCP_FIXTURES`
  map is empty with a `// TODO: paste 5-10 recorded responses (client lookup, loan
view, etc.)` comment. No recorded server responses are checked in.
- The prior commit that built out the Copilot core (365cc18b3, "WEB-1017: Add
  Copilot core services and confirmation dialog", PR #3696) states explicitly in
  its message: "No MCP wiring yet; that follows once the server contract is
  finalized."
- No design doc, ADR, README section, or OpenAPI/AsyncAPI spec describing the
  MCP endpoint, SSE event framing, auth, reconnection/backoff semantics, or the
  tool-call confirmation handshake exists under the repo (searched for
  `mcp`/`copilot` in `*.md` and for sibling docs directories; none found beyond
  the TypeScript interfaces already authored in
  `core/models/mcp-response.model.ts`, which are this project's own proposed
  shape, not a confirmed server contract).

Implementing `McpClient.stream()` / `McpClientService.sendMessage()` /
`handleToolCall()` now would mean guessing the wire format (SSE event names,
retry/backoff semantics, error payload shape, how tool-call confirmation is
signaled back to the server). Per the routine's instructions, this item is
skipped rather than guessed, and will be revisited once the server contract is
documented in the repo (e.g. fixtures populated, or a design doc/ADR added).

## Next step taken this run

Proceeding to implement `services/chat.service.ts` instead (next item in the
roadmap order).
