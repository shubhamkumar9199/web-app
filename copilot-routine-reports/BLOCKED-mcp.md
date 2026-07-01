# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-01

## Why this item was skipped

Roadmap item 4 (the SSE-based MCP transport) requires a documented wire
contract for the `/stream` endpoint: exact URL, auth headers, SSE framing,
retry/backoff semantics on the wire (not just the proposed client-side
values), and how `idempotencyKey` is transmitted (header vs. payload field).

The repo does not contain this contract yet:

- `src/app/copilot/services/mcp-fixtures.ts` is an empty stub whose own
  comment says fixtures are needed "so the UI can be built before the
  endpoint contract is finalised" — i.e. the contract is explicitly not
  finalized.
- `src/app/copilot/components/copilot-panel/copilot-panel.component.ts`
  documents the same gap: "the MCP server is not wired yet... Swap in
  ChatService once the endpoint contract is finalised."
- No `.md` docs, ADRs, or OpenAPI/AsyncAPI specs describing the MCP SSE
  stream were found anywhere in the repository (searched for `SSE`,
  `EventSource`, `text/event-stream`, `MCP` across `*.md`).
- `src/app/copilot/core/models/mcp-response.model.ts` defines the event
  _shape_ (`McpStreamEvent` with `token | tool_call | action_card | done |
error`), but not the transport contract (endpoint path, headers, error
  codes, retry-after behavior) needed to implement `McpClient.stream()`
  and `McpClientService.sendMessage()` correctly.

Implementing the actual `EventSource` wiring now would mean guessing at an
unstated server contract, which risks shipping a client that silently
disagrees with the real MCP server once it exists.

## What was done instead

Moved to the next roadmap item, `services/chat.service.ts`, which can be
implemented correctly today because it only depends on the already-typed
public API of `McpClientService` (`sendMessage(): Observable<McpStreamEvent>`,
`handleToolCall()`), not on how that API is implemented internally. It is
unit-tested against a mocked `McpClientService`, so it does not require the
SSE contract to be resolved.

## Follow-up

Once the MCP server team publishes the endpoint contract (URL, auth, SSE
framing, retry semantics), re-attempt item 4 and fill in `mcp-fixtures.ts`
with recorded responses.
