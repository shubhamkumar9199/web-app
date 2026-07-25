# NEEDS-PR: feature/WEB-AUTO-chat-service-orchestration-0725

Date: 2026-07-25
Run: scheduled Mifos Copilot development routine

## Why this note exists

The branch below has been implemented, tested green, and pushed to
`shubhamkumar9199/web-app`. This session's GitHub MCP access is scoped to
`shubhamkumar9199/web-app` only; attempting `create_pull_request` against
`openMF/web-app` (base `dev`, head
`shubhamkumar9199:feature/WEB-AUTO-chat-service-orchestration-0725`) returned
"Access denied: repository openmf/web-app is not configured for this
session." So the PR could not be opened automatically. Please open it
manually (or re-run with `openMF/web-app` added to the session's allowed
repositories) using the details below.

- Branch (pushed): `feature/WEB-AUTO-chat-service-orchestration-0725`
- Base: `dev`
- Head: `shubhamkumar9199:feature/WEB-AUTO-chat-service-orchestration-0725`
- Commit: `feat(copilot): implement ChatService orchestration and history persistence`

Note: an earlier, unrelated run of this routine had already pushed and
abandoned a branch named `feature/WEB-AUTO-chat-service-orchestration`
(no PR ever referenced it). To avoid overwriting that stale history, this
run's branch was pushed under the `-0725` suffix instead of reusing the
name.

## Ready PR title

```
feat(copilot): implement ChatService orchestration and history persistence
```

## Ready PR body

````markdown
## Description

Implements `ChatService` (`src/app/copilot/services/chat.service.ts`), the
orchestration layer for the Mifos Copilot chat panel. This was the next
unimplemented roadmap item: `core/response-parser.ts`,
`core/permission-checker.ts`, and `core/idempotency.ts` are already built,
and `core/mcp-client.ts` / `services/mcp-client.service.ts` (the SSE
transport) are intentionally still stubbed because the MCP endpoint/tool-call
wire contract is not yet finalized in this repo (see
`services/mcp-fixtures.ts`, which is an empty fixture map with the comment
"before the endpoint contract is finalised", and the TODO note in
`copilot-panel.component.ts`).

`ChatService` is built purely against the already-declared
`McpClientService` interface (`sendMessage(...): Observable<McpStreamEvent>`,
`handleToolCall(...)`), so it does not assume anything about the underlying
wire format and can be fully exercised with mocked collaborators.

What it does:

- `sendMessage(content)`: runs the message through `InputSanitizer` first
  and, if blocked, appends a plain-language notice instead of calling the
  MCP client. Otherwise it appends the user message, opens a streaming
  assistant message, and subscribes to `McpClientService.sendMessage(...)`,
  applying `token` / `tool_call` / `action_card` / `done` / `error` events
  onto that message as they arrive.
- On `done`, the accumulated text is run through `ResponseParser` to strip
  and extract any fenced ` ```action_card` `/` ```suggest` ` blocks that
  arrived as raw text rather than discrete events, then the turn is
  persisted (see below).
- `tool_call` events also forward to `McpClientService.handleToolCall(...)`
  so write-tool confirmation routing (already implemented there) still
  runs.
- `stopStreaming()`: unsubscribes from the active stream and marks the
  in-flight assistant message as no longer streaming.
- `clearChat()`: resets the message list and starts a new conversation id.
- `loadHistory()`: `GET`s `{mcpBaseUrl}/api/chat/history/{loggedInUser}` and
  falls back to a `localStorage` cache on any failure.
- Conversation history (title/preview/message count) is persisted to
  `conversations$` and mirrored to `localStorage` after each completed turn.

`McpClientService`/`McpClient` themselves are untouched and remain stubs.

## Related issues and discussion

This roadmap item does not yet have a Jira/WEB ticket number assigned;
please file/assign a `WEB-XXXX` issue and update the PR title/commit
accordingly before merge, following this repo's convention (see prior
Copilot PRs #3648, #3671, #3675, #3677, #3678, #3696).

## Screenshots, if any

Not applicable - this is a service-layer change with no UI wiring yet
(the panel component still uses its mock reply until the MCP endpoint
contract is finalized, per its own TODO comment).

## Verification summary

- `npx prettier --write` - clean
- `npx eslint src/app/copilot/services/chat.service.ts src/app/copilot/services/chat.service.spec.ts` - no errors
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` - 13/13 tests passing
- `npx ng build --configuration development` - build succeeds

## Checklist

- [x] If you have multiple commits please combine them into one commit by squashing them.
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
````
