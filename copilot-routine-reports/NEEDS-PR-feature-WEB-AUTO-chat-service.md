# NEEDS-PR: feature/WEB-AUTO-chat-service

Date: 2026-07-01

The branch is pushed to `shubhamkumar9199/web-app`, but this session's GitHub
access is scoped to that fork only (`openMF/web-app` is out of scope for the
connected GitHub MCP server, and `git fetch upstream` also gets a 403 from
the egress proxy). A pull request against `openMF/web-app` could not be
opened from here. Please open it manually, or re-run with access to
`openMF/web-app`.

## Ready PR

**Repo:** openMF/web-app
**Base:** dev
**Head:** shubhamkumar9199:feature/WEB-AUTO-chat-service

**Title:**

feat(copilot): implement ChatService conversation orchestration

**Body:**

## Summary

- Implements `ChatService` (roadmap item 5 of the Mifos Copilot core
  services), the conversation orchestrator that wires together the already
  implemented `InputSanitizer`, `ResponseParser`, `IdempotencyKeyFactory`,
  `McpClientService`, and `AiContextService`.
- `sendMessage`: sanitizes input (blocking on invalid length / prompt
  injection with a system message), appends the user message, opens a
  streaming assistant message, and applies `token` / `tool_call` /
  `action_card` / `done` / `error` events from `McpClientService.sendMessage`
  as they arrive. On completion it runs the accumulated text through
  `ResponseParser` to merge fenced action cards/suggestions with any
  structured `action_card` events, and clears `isStreaming`.
- `stopStreaming`: unsubscribes the in-flight stream and marks the message
  as no longer streaming (also unblocks the pending `sendMessage()` promise).
- `clearChat`: stops any active stream and resets the message list.
- `loadHistory`: `GET {mcpBaseUrl}/api/chat/history/{userId}`, falling back
  to `localStorage` (and to `localStorage` directly when there is no
  logged-in user), matching the contract already documented in the file's
  own TODO comments.
- Note: roadmap item 4 (`core/mcp-client.ts` + `services/mcp-client.service.ts`,
  the SSE transport) was evaluated first but skipped — the repo does not yet
  document the SSE/tool-call wire contract (endpoint, auth, framing, retry
  semantics); see `copilot-routine-reports/BLOCKED-mcp.md` for details.
  `ChatService` only depends on the already-typed public API of
  `McpClientService`, so it does not require that contract to be resolved.

## Jira

This PR needs a WEB-#### issue key assigned (roadmap item 5, "Copilot core
services: ChatService") and the branch/PR title updated accordingly before
merge.

## Verification

- `npx prettier --write` — clean
- `npx eslint` — clean
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` —
  12/12 passing (blocked-input handling, token streaming, tool_call routing,
  action_card + fenced-card merging, error finalization, stop/clear, history
  fetch + localStorage fallback)
- `npx jest --config jest.config.ts src/app/copilot` — full copilot suite,
  56/56 passing
- `npx ng build --configuration development` — succeeds
