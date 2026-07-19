# NEEDS-PR: feature/WEB-AUTO-copilot-chat-service-orchestration

**Date:** 2026-07-19
**Run:** automated Copilot roadmap routine

## Why this note exists

The branch is committed and pushed to
`shubhamkumar9199/web-app:feature/WEB-AUTO-copilot-chat-service-orchestration`,
but the GitHub MCP session for this run is scoped to read/write only
`shubhamkumar9199/web-app` - creating a pull request against
`openMF/web-app` (the actual target, per this routine's instructions)
returned "Access denied: repository is not configured for this session."

Please open the PR manually (or re-run with `openMF/web-app` write access
enabled) using the title and body below.

## PR details

**Repo:** openMF/web-app
**Base:** dev
**Head:** shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service-orchestration

**Title:**

```
WEB-XXXX: Wire ChatService orchestration and history for Mifos Copilot
```

**Body:**

```markdown
## Description

Implements `ChatService` (`services/chat.service.ts`), the next item on the Copilot roadmap after the pure-logic core landed in #3696. `sendMessage()` now:

- Runs the user's text through `InputSanitizer`; a blocked message (over-length or a detected prompt-injection attempt) short-circuits with a rejection reply and never reaches the MCP server.
- Streams the assistant reply through `McpClientService.sendMessage()`, accumulating `token` events and routing `tool_call` events to `McpClientService.handleToolCall()`.
- Parses the completed text with `ResponseParser` into prose, `ActionCard[]`, and suggested prompts.

`stopStreaming()` cancels an in-flight reply (and resolves the pending `sendMessage()` promise so a caller awaiting it doesn't hang). `clearChat()` starts a fresh conversation. `loadHistory()` fetches saved conversations from the MCP server's history endpoint and falls back to a localStorage cache when the request fails or no user is logged in; every completed turn is persisted the same way.

This builds against the DI interfaces already committed in the repo (`McpClientService`, `AiContextService`, `ResponseParser`, `InputSanitizer`) the same way `AiContextService`'s own tests mock its collaborators, so it's fully unit-testable independent of the live MCP transport. The actual SSE wire contract (`core/mcp-client.ts`) is still unimplemented pending the Java MCP plugin's published contract - the panel component's mocked reply and `mcp-fixtures.ts` stub are untouched by this PR.

## Related issues and discussion

Follow-up to #3696. Jira ticket number still needs to be assigned - please replace `WEB-XXXX` in the title once filed.

## Verification

- `npx jest --config jest.config.ts src/app/copilot` - 57/57 tests pass (13 new for `ChatService`, covering send/stream/parse, blocked input, error events, tool-call routing, stop-streaming, clear-chat, and history load with server/localStorage fallback).
- `npx eslint src/app/copilot` - clean.
- `npx prettier --check` - clean.
- `npx ng build --configuration development` - builds successfully.

## Screenshots, if any

N/A - service-layer change only, no UI wiring in this PR.

## Checklist

- [x] Single commit (no squashing needed).
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
```
