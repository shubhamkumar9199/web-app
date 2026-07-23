# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

**Date:** 2026-07-23
**Run:** automated Copilot routine

## Why this item was skipped

Roadmap item 4 (`core/mcp-client.ts` + `services/mcp-client.service.ts`, the SSE
transport) requires a documented MCP server contract: the exact SSE event
framing, endpoint path, auth headers, and retry/error semantics the client
must implement against.

Searched the repository for this contract before starting:

- `AGENTS.md`, `skills/SKILL.md`, `llms.txt` - general repo/contribution
  guidance, no mention of MCP, SSE, or the Copilot tool-call protocol.
- `AI.md` - an unrelated AI-tool benchmarking report, not a protocol spec.
- `src/app/copilot/services/mcp-fixtures.ts` - contains only a `TODO: paste
5-10 recorded responses` placeholder (`MCP_FIXTURES` is an empty object),
  confirming the endpoint contract is explicitly not finalised yet.
- No OpenAPI/AsyncAPI spec, README, or design doc describing the SSE event
  shape or endpoint beyond the `McpStreamEvent`/`McpClientOptions` TypeScript
  interfaces already stubbed in `core/models/mcp-response.model.ts` and
  `core/mcp-client.ts`.

Implementing `McpClient.stream()` and `McpClientService.sendMessage()` now
would mean guessing the wire protocol (event names, retry/backoff triggers,
auth) rather than building against an agreed contract. Per the routine's
instructions, this item is skipped rather than guessed, and the run moved on
to the next roadmap item instead.

## Next roadmap item picked up this run

Item 5, `services/chat.service.ts` (orchestration + history), was implemented
in this run. It depends on `McpClientService` only through its public
`sendMessage(message, context, idempotencyKey): Observable<McpStreamEvent>`
and `handleToolCall(event)` methods (both already declared in
`services/mcp-client.service.ts`), so it can be built, unit-tested (with a
mocked `McpClientService`), and merged independently of the transport work.
`ChatService` will start working end-to-end as soon as items 4's contract is
documented and implemented - no further changes to `ChatService` should be
needed.

## What would unblock item 4

Once the MCP server team publishes the SSE contract (event types already
sketched: `token` / `tool_call` / `action_card` / `done` / `error`, endpoint
path, and auth/retry behavior), a future run can implement
`core/mcp-client.ts` (raw `EventSource` + timeout + backoff) and
`services/mcp-client.service.ts` (Observable wrapper + tool-call routing)
directly against it.
