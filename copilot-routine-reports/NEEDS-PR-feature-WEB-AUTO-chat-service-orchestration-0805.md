# NEEDS-PR: feature/WEB-AUTO-chat-service-orchestration-0805

Date: 2026-08-05
Run: automated Copilot roadmap routine

## Why this note exists instead of a PR

This session's GitHub tool access is scoped to `shubhamkumar9199/web-app` only
(the fork). Opening a PR requires targeting the base repo `openMF/web-app`,
which this session is not authorized to write to, and no `gh` CLI is
available in this environment either. The branch is pushed and ready; a PR
just needs to be opened by a session/token with `openMF/web-app` access.

**Branch:** `shubhamkumar9199:feature/WEB-AUTO-chat-service-orchestration-0805`
**Base:** `openMF/web-app:dev`

## Heads-up: this item has been attempted many times before without merging

Before starting, `git ls-remote origin` turned up a long list of previously
pushed branches for this exact roadmap item, dating back to June/July:
`feature/WEB-AUTO-chat-service`, `feature/WEB-AUTO-chat-service-orchestration`
(plus `-0725`, `-0727`, `-jul31` suffixes), `feature/WEB-AUTO-copilot-chat-*`
variants (plus `-0721`, `-0723`, `-0729`, `-0801` suffixes), and
`feature/WEB-AUTO-response-parser`.

Despite all those attempts, a fresh `git reset --hard upstream/dev` at the
start of this run showed `src/app/copilot/services/chat.service.ts` still
throwing `Error('Not implemented')` in every method. So whatever happened to
those earlier branches/PRs, none of them landed in `dev`. Worth a human
look at the PR history on `openMF/web-app` for
`shubhamkumar9199:feature/WEB-AUTO-*chat*` and `*copilot-chat*` branches to
see why (closed without merge? stuck in review? CI failing?) before more
automated runs keep re-doing this same work.

By contrast, the other three roadmap items ahead of this one in the queue
(`response-parser.ts`, `permission-checker.ts`, `idempotency.ts`) are all
already implemented in `dev` with no stub markers left, so those did land
successfully.

## Suggested PR

**Title:** `feat(copilot): implement ChatService conversation orchestration and history`

**Body:**

```markdown
## Summary

- Implements `ChatService` (roadmap item 5: "orchestration + history"),
  replacing all four `throw new Error('Not implemented')` stubs in
  `src/app/copilot/services/chat.service.ts`.
- `sendMessage`: sanitizes input via `InputSanitizer`, appends the user
  message, opens the MCP stream via `McpClientService.sendMessage`, and
  applies `token` / `tool_call` / `action_card` / `error` / `done` events to
  a live assistant message. Suggested follow-up prompts are parsed out of
  the finished text via `ResponseParser` (fenced `suggest` blocks).
  Never throws to the caller - blocked input becomes a `system` message,
  a stream error becomes a friendly assistant message.
- `stopStreaming`: unsubscribes the active MCP stream and finalizes the
  in-progress assistant message with whatever text arrived so far.
- `clearChat`: resets the message list and starts a new session id.
- `loadHistory`: `GET /api/chat/history/{userId}`, falling back to a
  per-user `localStorage` cache on any network failure. Each completed
  turn also snapshots the active conversation into `conversations$`,
  writes it to `localStorage`, and best-effort `POST`s it to the same
  endpoint (fire-and-forget; failures do not affect the UI).

## Note on Jira/WEB numbering

This is an automated roadmap run; no WEB-XXXX ticket has been created or
assigned for this specific piece of work. Please assign one (or link this
PR to the relevant Copilot epic) as part of triage.

## Verification

- `npx prettier --check` - clean
- `npx eslint` - clean
- `npx jest --config jest.config.ts src/app/copilot` - 6 suites / 53 tests
  pass, including the new `chat.service.spec.ts` (9 tests covering blocked
  input, streaming token/tool_call/action_card/done handling, suggested
  prompt extraction, stream error fallback, stopStreaming, clearChat, and
  loadHistory success/fallback). `chat.service.ts` itself is at 96%
  statement coverage.
- `npx ng build --configuration development` - builds clean.

## Scope note

`core/mcp-client.ts` and `services/mcp-client.service.ts` (roadmap item 4,
the SSE transport) were intentionally left untouched this run - the
SSE/tool-call contract with the MCP server is not yet documented/finalised
in the repo (see `services/mcp-fixtures.ts` and the note in
`copilot-panel.component.ts`). See
`copilot-routine-reports/BLOCKED-mcp.md` for details. `ChatService` is
written against the existing `McpClientService` interface so no rework
should be needed once that transport lands.
```
