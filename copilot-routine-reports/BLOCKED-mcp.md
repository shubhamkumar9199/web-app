# Blocked: core/mcp-client.ts + services/mcp-client.service.ts

Date: 2026-07-27

## Why this item was skipped

The task list says to implement the SSE transport (`core/mcp-client.ts`) and its
Angular wrapper (`services/mcp-client.service.ts`) only if the SSE / tool-call
contract with the MCP server is documented in the repo. It is not.

Evidence:

- `src/app/copilot/services/mcp-fixtures.ts` is an empty stub:

  ```ts
  export const MCP_FIXTURES: Record<string, McpResponse> = {
    // TODO: paste 5-10 recorded responses (client lookup, loan view, etc.).
  };
  ```

  Its own doc comment says these fixtures are meant to be captured "before
  the endpoint contract is finalised" — i.e. the contract is explicitly not
  finalized yet.

- `src/app/copilot/core/mcp-client.ts` only has a proposed shape for
  `McpClientOptions` (`timeoutMs`, `maxRetries`), annotated as "(proposal:
  15s)" and "(proposal: 3)" rather than settled values.

- There is no `baseUrl` path, auth header scheme, exact SSE event framing
  (event names, field casing, error payload shape), or backend endpoint
  spec checked into the repo anywhere (no README, no docs/, no OpenAPI/AsyncAPI
  file under `src/app/copilot`).

- `core/models/mcp-response.model.ts` defines a plausible `McpStreamEvent`
  shape (`token | tool_call | action_card | done | error`), but that is a
  client-side type proposal, not a confirmed contract with the actual MCP
  server (no server-side reference, integration test, or recorded fixture
  backs it up).

Implementing the SSE client against an unconfirmed contract risks locking in
wrong assumptions (retry semantics, event framing, auth) that would need to be
reworked once the real MCP server contract lands, and there is nothing in the
repo to unit test the transport against.

## Action taken

Skipped item 4 (`core/mcp-client.ts` + `services/mcp-client.service.ts`) for
this run, per the routine's instructions, and moved on to item 5
(`services/chat.service.ts`).

## Suggested follow-up

Once the MCP server team documents/finalizes the SSE contract (endpoint,
auth, event schema) and a few recorded fixtures are added to
`mcp-fixtures.ts`, this item can be picked up in a future run.
