# Needs PR: feature/WEB-AUTO-chat-service-orchestration-0727

Date: 2026-07-27

The branch is pushed to `shubhamkumar9199/web-app`. This session's GitHub
access is scoped to `shubhamkumar9199/web-app` only, so it cannot open a
pull request against `openMF/web-app`. Please open it manually (or from a
session with the right scope) with the details below.

## PR to create

- Repo: `openMF/web-app`
- Base: `dev`
- Head: `shubhamkumar9199:feature/WEB-AUTO-chat-service-orchestration-0727`

### Title

```
feat(copilot): implement chat orchestration and history persistence
```

### Body

````
## What

Implements `ChatService`, the next unimplemented item on the Copilot
roadmap (core/response-parser.ts, core/permission-checker.ts and
core/idempotency.ts were already done; core/mcp-client.ts +
services/mcp-client.service.ts remain blocked, see below).

- `sendMessage`: sanitizes the input with `InputSanitizer`, appends the
  user message, then streams the assistant reply through
  `McpClientService`. Every `token` chunk is re-parsed with
  `ResponseParser` so the visible content, action cards and suggested
  prompts stay in sync while streaming (fenced ```action_card```/```suggest```
  blocks are stripped from the displayed text). `tool_call` events record
  `toolUsed` on the message and delegate to
  `McpClientService.handleToolCall` for the read/write confirmation
  branching that service owns.
- `stopStreaming`: unsubscribes the active stream and resolves the
  in-flight `sendMessage()` promise so callers never hang.
- `clearChat`: resets the message list and starts a new session id.
- `loadHistory`: fetches recent conversations for the logged-in user from
  the MCP server (`environment.copilotMcpBaseUrl` + `/api/chat/history/{userId}`)
  and falls back to a `localStorage` cache when there is no logged-in
  user or the request fails. Each completed turn is snapshotted into that
  same cache for the Recent Chats tab.

## Roadmap / tracking

This is a Copilot roadmap item; no Jira/WEB issue number has been
assigned yet, so the title/commit intentionally uses the
`feat(copilot): ...` form instead of a `WEB-XXXX:` prefix. Please assign a
WEB number and retitle if your process requires it before merge.

Note: `core/mcp-client.ts` and `services/mcp-client.service.ts` (the SSE
transport) are still stubbed. The SSE/tool-call contract with the MCP
server is not finalized in this repo yet (`services/mcp-fixtures.ts` is an
empty TODO, and `McpClientOptions` fields are marked "(proposal)"), so
that item was intentionally left out of scope for this change; `ChatService`
is written against the existing `McpClientService` interface and will work
once that transport lands.

## Verification

- `npx prettier --check` — clean
- `npx eslint` — clean
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` — 12/12 passing
- `npx jest --config jest.config.ts src/app/copilot/` — full copilot suite, 56/56 passing
- `npx ng build --configuration development` — succeeds
````

## Other notes for the operator

- While preparing this branch, found several stale branches on the fork
  from earlier automated runs of this same routine, all targeting
  `chat.service.ts` and all cut from a much older `dev` snapshot (e.g.
  `feature/WEB-AUTO-chat-service-orchestration`, `-copilot-chat-service-0721`,
  `-0723`, `-0725`, `-copilot-chat-service-2`, etc.). None of their changes
  are in `upstream/dev` (the stub there is still unimplemented), so it
  looks like earlier runs never got a PR opened/merged. Worth checking
  whether any of those already have an open PR upstream before this one
  is opened, to avoid duplicates. This run's branch was suffixed `-0727`
  specifically to avoid colliding with the existing `-orchestration`
  branch (same name, unrelated/older history).
- `core/mcp-client.ts` + `services/mcp-client.service.ts` were skipped this
  run as blocked; see `copilot-routine-reports/BLOCKED-mcp.md`.
