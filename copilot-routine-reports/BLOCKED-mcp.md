# BLOCKED: core/mcp-client.ts + services/mcp-client.service.ts

**Date:** 2026-07-19
**Run:** automated Copilot roadmap routine

## Why this item is skipped

Item 4 (`core/mcp-client.ts` SSE transport and its `services/mcp-client.service.ts`
DI wrapper) requires a documented wire-level contract for the MCP server: the
SSE endpoint path, auth headers, exact event framing, and tool-call semantics.

No such documentation exists in this repository:

- `core/mcp-client.ts` labels its own timeout/retry values as a "proposal"
  (`timeoutMs`, `maxRetries` comments), not a confirmed spec.
- `services/mcp-fixtures.ts` is an empty stub with the comment "Used for local
  development and unit tests so the UI can be built before the endpoint
  contract is finalised."
- `components/copilot-panel/copilot-panel.component.ts` still uses a mocked
  `respondMock()` reply, with an explicit note: "the MCP server is not wired
  yet ... Swap in ChatService once the endpoint contract is finalised."
- A repo-wide search for MCP/SSE documentation (`*.md` files, `docs/`) found
  no mention of the actual Mifos MCP server contract.
- The most recent merged Copilot PR (#3696, WEB-1017) states explicitly:
  "MCP client, chat orchestration, and panel wiring come in a follow-up once
  the endpoint contract (Java plugin, SSE, Fineract auth/RBAC) is confirmed."

Per the routine's instructions, this item is skipped rather than guessing at
an unconfirmed transport contract. Moving to the next roadmap item
(`services/chat.service.ts`).

## Next step

Once the Java MCP plugin's SSE contract is published (endpoint path, event
schema, auth handshake, retry/backoff expectations), implement
`McpClient.stream()` and `McpClientService.sendMessage()` /
`handleToolCall()` against it, with fixtures recorded from the live server in
`mcp-fixtures.ts`.
