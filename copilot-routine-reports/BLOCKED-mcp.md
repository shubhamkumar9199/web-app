# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-25
Run: scheduled Mifos Copilot development routine

## Why this item was skipped

Roadmap item 4 (`core/mcp-client.ts` and `services/mcp-client.service.ts`, the SSE
transport) was next in line but the underlying wire contract is not documented
anywhere in the repository:

- `src/app/copilot/services/mcp-fixtures.ts` contains only an empty fixture map
  with the comment: "Used for local development and unit tests so the UI can be
  built before the endpoint contract is finalised." and a TODO to paste in 5-10
  recorded responses that were never added.
- `src/app/copilot/components/copilot-panel/copilot-panel.component.ts` currently
  uses a hardcoded mock reply (`respondMock`) with the note: "the MCP server is
  not wired yet ... Swap in ChatService once the endpoint contract is finalised."
- No ADR, README, or design doc in the repo specifies the actual HTTP/SSE
  request/response envelope, authentication, or error semantics for the MCP
  server beyond the client-side TypeScript interfaces already declared in
  `core/models/mcp-response.model.ts` (`McpStreamEvent`, event type strings).

Implementing the real `EventSource` handshake, retry/backoff behavior, and
payload framing would require guessing an unfinalized network contract, which
risks baking in an incorrect protocol that has to be reverted later.

## Action taken

Per the routine's instructions, this item was skipped and development moved to
the next roadmap item: `services/chat.service.ts` (orchestration + history).
`ChatService` was implemented against the already-declared `McpClientService`
public interface (`sendMessage(...): Observable<McpStreamEvent>`,
`handleToolCall(...)`) without assuming anything about the wire format
underneath it, so it can be exercised in isolation with mocked collaborators
in `chat.service.spec.ts`. `McpClientService`/`McpClient` themselves remain
stubs (`throw new Error('Not implemented')`) until the endpoint contract is
finalized and documented.

## Suggested follow-up

Once the Mifos MCP server team publishes the SSE event contract (event names,
JSON envelope, auth header, error codes), a future run can revisit
`core/mcp-client.ts` and `services/mcp-client.service.ts` directly.
