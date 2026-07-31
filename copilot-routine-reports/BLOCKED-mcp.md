# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-31

## Why this item was skipped

The roadmap item calls for implementing the SSE transport (`McpClient.stream()`)
and its Angular wrapper (`McpClientService.sendMessage()` / `handleToolCall()`),
but the SSE / tool-call contract with the actual MCP server is not documented
or finalized anywhere in the repository:

- `src/app/copilot/core/mcp-client.ts` only has proposed defaults in comments
  (`timeoutMs` "proposal: 15s", `maxRetries` "proposal: 3") — these are not
  confirmed values from a real server.
- `src/app/copilot/services/mcp-fixtures.ts` is an empty stub:
  `export const MCP_FIXTURES: Record<string, McpResponse> = {};` with a TODO
  comment stating fixtures should be "recorded responses captured from the
  live server during community bonding" and that the UI is being built
  "before the endpoint contract is finalised."
- No markdown docs, ADRs, or OpenAPI/AsyncAPI spec describing the MCP SSE
  event framing, authentication, retry semantics, or tool-call confirmation
  handshake were found under the repo (`AI.md` is unrelated to this feature).

Implementing the transport now would mean guessing the wire contract
(event framing, error semantics, retry/backoff behavior, how tool_call
confirmation responses are sent back to the server), which risks building
against an incorrect contract that would need to be reworked once the real
MCP server behavior is documented.

## Action taken

Per the routine's instructions, this item was skipped and the run moved on
to the next roadmap item (services/chat.service.ts orchestration + history).

## Suggested follow-up

Once the MCP server team documents the SSE event contract (or the fixtures
in `mcp-fixtures.ts` are populated with real recorded responses), a future
run can implement `McpClient.stream()` and `McpClientService` against that
contract.
