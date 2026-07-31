# NEEDS PR: feature/WEB-AUTO-chat-service-orchestration-jul31

Date: 2026-07-31

## Why this note exists

This session's GitHub access is scoped to `shubhamkumar9199/web-app` only (no
`gh` CLI, and the GitHub MCP server rejects any `owner`/`repo` other than the
fork). Opening a PR against `openMF/web-app` requires that cross-repo access,
so the branch has been pushed but the PR could not be created automatically.

**Branch pushed:** `feature/WEB-AUTO-chat-service-orchestration-jul31` on
`shubhamkumar9199/web-app`
(https://github.com/shubhamkumar9199/web-app/tree/feature/WEB-AUTO-chat-service-orchestration-jul31)

## Note on branch naming

The originally intended branch name,
`feature/WEB-AUTO-chat-service-orchestration`, already exists on the fork
from an earlier run (commit `3dbd19c`, based on an old `dev` snapshot from
around 2026-07-03 that predates ~290 files' worth of upstream changes). That
branch appears to be stale/abandoned - no open or closed PR for it was found
against this fork - and pushing to it would have required a non-fast-forward
force-push, which this routine avoids. This run's work was pushed under a
disambiguated name instead so nothing is overwritten; a human may want to
clean up the old stale branch.

## Ready PR (open manually against openMF/web-app, base `dev`)

**Title:**

```
feat(copilot): implement ChatService conversation orchestration and history
```

**Body:**

````
## Description

Implements the next unimplemented item on the Mifos Copilot roadmap:
`services/chat.service.ts`. `ChatService` now orchestrates a full
conversation turn:

- Runs user input through `InputSanitizer` first; blocked input (too
  long / prompt-injection pattern) short-circuits with a `system`
  message and never reaches the MCP client.
- Sends the sanitized message via `McpClientService`, streaming
  `token` / `tool_call` / `action_card` / `error` / `done` events into
  the live assistant message (`messages$`).
- Runs the assembled text through `ResponseParser` on `done` so any
  fenced ```action_card```/```suggest``` blocks the assistant embeds
  in its prose are also picked up, in addition to discrete
  `action_card` SSE events.
- Degrades gracefully: both a stream-level error and a synchronous
  throw from the (still-unimplemented) MCP transport are caught and
  surfaced as a plain error message instead of rejecting/throwing.
- `stopStreaming()` unsubscribes the in-flight request and settles the
  last assistant message.
- `clearChat()` resets the message list and starts a new conversation id.
- `loadHistory()` fetches `${copilotMcpBaseUrl}/api/chat/history/{userId}`
  and falls back to a localStorage cache on any HTTP error or when
  there is no logged-in user; each completed turn is also saved to
  that localStorage cache as a `Conversation`.

This item was picked because it was the first roadmap item whose impl
file still had `throw new Error('Not implemented')`. Roadmap item 4
(`core/mcp-client.ts` + `services/mcp-client.service.ts`, the SSE
transport) was skipped for this run because the SSE/tool-call wire
contract is not yet documented anywhere in the repo (see
`copilot-routine-reports/BLOCKED-mcp.md` for details) -
`ChatService` is written against the already-fully-typed
`McpStreamEvent` contract and the `McpClientService` interface, so it
does not need that transport to be finalized to be tested or reviewed;
it will "just work" once that transport lands.

**Note:** this PR needs a Jira/WEB issue number assigned before merge;
none was available to this automated run.

## Related issues and discussion

Mifos Copilot roadmap - orchestration/history item. Jira/WEB number: TBD.

## Verification summary

- `npx prettier --write` - clean.
- `npx eslint` - no errors on the changed files.
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts`
  - 13/13 passing, plus a full `src/app/copilot` run (57/57 passing,
    no regressions in the other Copilot specs).
- `npx ng build --configuration development` - builds successfully.

## Checklist

- [x] Single commit (squashed).
- [ ] Read and understood the contribution guidelines at
      `web-app/.github/CONTRIBUTING.md` (automated run - please have a
      maintainer confirm on review).
````

## Files in this change

- `src/app/copilot/services/chat.service.ts` (implementation)
- `src/app/copilot/services/chat.service.spec.ts` (new spec, 13 tests)
- `copilot-routine-reports/BLOCKED-mcp.md` (records why item 4 was skipped this run)
