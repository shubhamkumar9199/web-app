# PR needed: feature/WEB-AUTO-copilot-chat-orchestration

Date: 2026-07-15

## Why this note instead of an opened PR

This session's GitHub access is scoped to `shubhamkumar9199/web-app` only.
Opening a PR against `openMF/web-app` (the upstream base repo) requires a
`create_pull_request` call targeting `owner: openMF`, which is outside that
scope and would be denied. The branch is pushed and ready; a maintainer or a
session with broader GitHub scope needs to open the PR below.

## Branch

`shubhamkumar9199:feature/WEB-AUTO-copilot-chat-orchestration` -> `openMF/web-app:dev`

## Ready-to-use PR

**Title:**

```
feat(copilot): implement ChatService conversation orchestration and history
```

**Body:**

```markdown
## Description

Implements `src/app/copilot/services/chat.service.ts`, the next unimplemented
item on the Mifos Copilot roadmap (`ChatService`: orchestration + history).
Previously every method threw `Not implemented`.

`ChatService` now:

- Runs outgoing text through the existing `InputSanitizer` before sending,
  and surfaces a `system` chat message when a message is blocked (too long
  or a detected prompt-injection phrasing) instead of calling MCP.
- Appends a user message (tagged with the focused `clientId` from
  `AiContextService`) and a placeholder streaming assistant message, then
  subscribes to `McpClientService.sendMessage(...)`, folding `token`,
  `tool_call`, `action_card`, and `error` events into that assistant message
  as they arrive.
- Routes `tool_call` events to `McpClientService.handleToolCall(...)` and
  records which tool was used on the final message.
- On stream completion (or error), runs the assembled text through the
  existing `ResponseParser` to extract prose, action cards, and suggested
  follow-up prompts, merging in any cards that arrived as explicit
  `action_card` stream events.
- Supports `stopStreaming()` (unsubscribes and marks the in-flight message
  done) and `clearChat()` (stops streaming, starts a fresh session/message
  list).
- `loadHistory()` fetches conversations from
  `{mcpBaseUrl}/api/chat/history/{userId}` and mirrors them to
  `localStorage`; on a failed request it falls back to whatever was last
  cached in `localStorage`. Every completed turn is persisted the same way
  (best-effort PUT to the server, always mirrored locally) so history
  survives a lost connection, per the class's existing doc comment.

Note: `McpClientService.sendMessage`/`handleToolCall` and the underlying
`core/mcp-client.ts` SSE transport are still `Not implemented` — the MCP
SSE/tool-call wire contract isn't documented anywhere in the repo (empty
`mcp-fixtures.ts`, no spec) and the roadmap explicitly says to skip that item
until a real contract exists (see
`copilot-routine-reports/BLOCKED-mcp.md` in this run). `ChatService` consumes
`McpClientService` as an injected collaborator so it's ready to work as soon
as that transport lands; in the meantime it's fully exercised in
`chat.service.spec.ts` against a mocked `McpClientService`.

## Roadmap / issue tracking

This work isn't tied to an existing issue. A Jira/WEB ticket number should be
assigned to this item (`ChatService` orchestration) and linked here.

## Verification summary

- `npx prettier --write` — clean, no further changes needed after formatting.
- `npx eslint` — no errors or warnings on the changed files.
- `npx jest --config jest.config.ts src/app/copilot` — all 6 suites / 54 tests
  pass, including the new `chat.service.spec.ts` (10 tests covering:
  sanitize-and-block, token streaming, action_card/suggest parsing,
  tool_call routing, stream-error fallback text, ignoring a second send while
  streaming, `stopStreaming`, `clearChat`, and both `loadHistory` paths).
- `npx ng build --configuration development` — builds successfully (one
  pre-existing, unrelated `NG8113` warning on
  `ReportingDashboardComponent`, not touched by this change).

## Screenshots, if any

N/A — service-layer change with no template/UI changes.

## Checklist

- [x] Single commit.
- [x] Read and understood the contribution guidelines at
      `web-app/.github/CONTRIBUTING.md`.
```
