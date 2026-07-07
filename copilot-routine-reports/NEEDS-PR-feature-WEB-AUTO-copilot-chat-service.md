# NEEDS-PR: feature/WEB-AUTO-copilot-chat-service

Date: 2026-07-07

This session's GitHub access is scoped to `shubhamkumar9199/web-app` only;
`openMF/web-app` is out of scope for the connected GitHub tooling, so a pull
request against `openMF/web-app` could not be opened from here. Please open
it manually, or re-run with access to `openMF/web-app`.

The branch `feature/WEB-AUTO-copilot-chat-service` was already implemented
and pushed to `shubhamkumar9199/web-app` by an earlier automated run (same
blocker: no PR access to `openMF/web-app`). It is still based on the current
`dev` tip (`63129a71f`, no rebase needed) and this run re-verified it end to
end before writing this note: no new commit was needed.

## Ready PR

**Repo:** openMF/web-app
**Base:** dev
**Head:** shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service

**Title:**

feat(copilot): implement ChatService orchestration and history persistence

**Body:**

## Summary

- Implements `ChatService` (roadmap item 5 of the Mifos Copilot core
  services), the conversation orchestrator that wires together the already
  implemented `InputSanitizer`, `ResponseParser`, `McpClientService`,
  `AiContextService`, and `AuthenticationService`.
- `sendMessage`: appends the (trimmed) user message, sanitizes it (blocking
  on invalid length / prompt injection with a `system`-role message and no
  MCP call), opens a streaming assistant message, and applies `token` /
  `tool_call` / `action_card` / `done` / `error` events from
  `McpClientService.sendMessage` as they arrive. On completion it runs the
  accumulated text through `ResponseParser` to merge fenced action
  cards/suggestions with any structured `action_card` events, clears
  `isStreaming`, and persists the conversation.
- `stopStreaming`: unsubscribes the in-flight stream, finalizes the message
  as no longer streaming, and resolves the pending `sendMessage()` promise.
- `clearChat`: stops any active stream, starts a new session id, and resets
  the message list.
- `loadHistory`: `GET {mcpBaseUrl}/api/chat/history/{userId}`, falling back
  to `localStorage` on error or when there is no logged-in user, matching
  the contract documented in the file's own TODO comments.
- Roadmap item 4 (`core/mcp-client.ts` + `services/mcp-client.service.ts`,
  the SSE transport) was evaluated first but skipped again — the repo still
  does not document the SSE/tool-call wire contract (endpoint, auth, framing,
  retry semantics); see `copilot-routine-reports/BLOCKED-mcp.md`.
  `ChatService` only depends on the already-typed public API of
  `McpClientService`, so it does not require that contract to be resolved.

## Jira

This PR needs a WEB-#### issue key assigned (roadmap item 5, "Copilot core
services: ChatService") and the branch/PR title updated accordingly before
merge.

## Verification (re-run 2026-07-07)

- `npx prettier --check` on the two changed files — clean
- `npx eslint` on the two changed files — clean
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` —
  18/18 passing
- `npx jest --config jest.config.ts src/app/copilot` — full copilot suite,
  62/62 passing
- `npx ng build --configuration development` — succeeds
