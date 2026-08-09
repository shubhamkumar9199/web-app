# NEEDS PR: claude/tender-feynman-7yeoqa

Date: 2026-08-09
Run: automated Copilot routine

## Status

The branch is pushed to `shubhamkumar9199/web-app`. GitHub PR creation could
not be completed from this session because its GitHub MCP access is scoped
only to `shubhamkumar9199/web-app` - `openMF/web-app` (the PR target repo)
is out of scope and every call against it is denied. This is the
`gh`-not-authenticated case described in the run instructions: branch
pushed, PR needs to be opened manually.

## Branch name note

The run instructions asked for a branch named `feature/WEB-AUTO-chat-service`.
This session's git push credentials are scoped to a single designated
branch, `claude/tender-feynman-7yeoqa` (per this session's own hard rules:
"NEVER push to a different branch without explicit permission"), and a push
to `feature/WEB-AUTO-chat-service` was rejected with HTTP 403. The commit
was moved (fast-forward only, no rewrite) onto `claude/tender-feynman-7yeoqa`
and pushed there instead. That branch is a strict fast-forward of `dev`
plus the one commit below, so the PR content is unaffected - only the
branch name differs from what was requested.

## Ready PR

**Repo:** openMF/web-app
**Base:** dev
**Head:** shubhamkumar9199:claude/tender-feynman-7yeoqa

**Title:**
feat(copilot): implement chat service orchestration and history

**Body:**

Roadmap item 5 of the Mifos Copilot build-out: `services/chat.service.ts`
(orchestration + history). Implements `ChatService`:

- `sendMessage`: sanitizes input (`InputSanitizer`), appends the user
  message, streams the assistant reply through `McpClientService`, and
  parses the finished response (`ResponseParser`) into text, action cards,
  and suggested prompts. Degrades gracefully on any failure (sanitizer
  block, stream error, or the MCP client throwing) by finishing the
  assistant message with a readable notice instead of throwing.
- `stopStreaming`: unsubscribes the active stream and marks the in-flight
  message as no longer streaming.
- `clearChat`: resets the message list and cancels any active stream.
- `loadHistory`: loads conversations from the MCP server
  (`GET {copilotMcpBaseUrl}/api/chat/history/{userId}`) with a
  localStorage fallback when the request fails or there is no logged-in
  user.

Note: roadmap item 4 (`core/mcp-client.ts` +
`services/mcp-client.service.ts`, the SSE transport `ChatService` calls
into) was skipped in this same run because its SSE/tool-call contract is
not yet documented/finalized upstream - see
`copilot-routine-reports/BLOCKED-mcp.md` in this branch for detail.
`ChatService` is written against the two services' existing method
signatures and is unit-tested with a mocked `McpClientService`, so it does
not depend on that transport being implemented to be reviewed or merged.

This PR needs a Jira/WEB issue number assigned (roadmap item 5 did not
have one at the time this ran); please retitle/relabel once assigned.

**Verification:**

- `npx prettier --write` - clean
- `npx eslint` - clean (no warnings/errors)
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts`
  and the full `src/app/copilot` suite - 6 suites, 60 tests, all passing
- `npx ng build --configuration development` - succeeded
