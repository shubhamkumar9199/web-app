# NEEDS PR: feature/WEB-AUTO-copilot-chat-service-0723

**Date:** 2026-07-23
**Run:** automated Copilot routine

## Why this note exists

The branch is committed and pushed to `shubhamkumar9199/web-app`, but this
session's GitHub tool is scoped to write-access on `shubhamkumar9199/web-app`
only. Creating a pull request against `openMF/web-app` (a different
repository) was denied:

```
Access denied: repository "openmf/web-app" is not configured for this session.
Allowed repositories: shubhamkumar9199/web-app
```

(Read-only calls against `openMF/web-app`, e.g. searching pull requests,
did succeed - only the write/create call was blocked.)

Please open the PR manually (or re-run with `gh`/GitHub write access to
`openMF/web-app` authorized) using the details below.

## Branch

`shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service-0723` -> `openMF/web-app:dev`

Compare URL: https://github.com/openMF/web-app/compare/dev...shubhamkumar9199:web-app:feature/WEB-AUTO-copilot-chat-service-0723

Note: an earlier, unrelated automated run already pushed a stale branch
named exactly `feature/WEB-AUTO-copilot-chat-service` (no PR was ever opened
for it, and it appears well behind current `dev`). This run intentionally
used a distinct name to avoid colliding with that stale branch. That old
branch is otherwise untouched by this run.

## PR title

```
feat(copilot): implement ChatService message orchestration and history
```

## PR body

```markdown
## Description

Implements `services/chat.service.ts`, the next item on the Copilot roadmap (`core/response-parser.ts`, `core/permission-checker.ts` and `core/idempotency.ts` were completed in earlier PRs and are already merged into `dev`).

`ChatService` orchestrates a conversation turn end to end:

- `sendMessage(content)` runs the text through `InputSanitizer` first; input that is too long or matches a prompt-injection pattern is rejected locally with an inline assistant message and never reaches `McpClientService`. Valid input is appended as a user message, then streamed through `McpClientService.sendMessage()`; `token` events accumulate into the live assistant message, `tool_call` events are routed to `McpClientService.handleToolCall()`, and `action_card` events are collected. On stream completion (or error), the accumulated text is run through `ResponseParser` to extract action cards and suggested prompts, and the message is marked as settled.
- `stopStreaming()` unsubscribes the active stream and settles the in-flight `sendMessage()` call so it doesn't hang.
- `clearChat()` resets the message list and starts a new conversation id.
- `loadHistory()` fetches saved conversations from the MCP server (`GET /api/chat/history/{userId}`) and falls back to a `localStorage` cache when the request fails or there is no logged-in user; each completed turn is also cached locally via `persistConversation()`.

The service depends on `McpClientService` only through its already-declared public interface (`sendMessage(...): Observable<McpStreamEvent>`, `handleToolCall(event)`), so it is independently testable and mergeable ahead of the MCP/SSE transport work.

**Note on item 4 (MCP SSE transport):** before starting this item, I looked for a documented SSE/tool-call contract for `core/mcp-client.ts` / `services/mcp-client.service.ts` (checked `AGENTS.md`, `skills/SKILL.md`, `llms.txt`, `AI.md`, and `services/mcp-fixtures.ts`) and didn't find one - `mcp-fixtures.ts` still has a `TODO: paste 5-10 recorded responses` placeholder, confirming the endpoint contract isn't finalized yet. That item is skipped rather than guessed at, and `ChatService` will start working end-to-end as soon as it's implemented against a documented contract.

**Jira/WEB number:** this PR was produced by an automated routine and does not yet have a WEB-#### issue assigned in Mifos Jira. Please assign one and I'll happily update the title/commit if a specific format is required.

## Related issues and discussion

Follows on from #3696 (Copilot core services). No related WEB issue assigned yet - see note above.

## Screenshots, if any

N/A - this is an orchestration service with no UI surface yet; `CopilotPanelComponent` still uses its mock reply pending this and the MCP transport work.

## Verification

- `npx prettier --check` clean
- `npx eslint` clean (TS)
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` - 16/16 passing, covering: input rejection (length/injection), token streaming, action-card/suggestion extraction, tool-call routing, direct action-card stream events, error fallback (both async stream error and synchronous transport throw), stream cancellation/supersession, chat clearing, and history load/fallback (remote success, remote failure, no logged-in user)
- `npx ng build --configuration development` - green

## Checklist

Please make sure these boxes are checked before submitting your pull request - thanks!

- [x] If you have multiple commits please combine them into one commit by squashing them.
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
```

## Verification already performed this run

- `npx prettier --write` on both new/changed files - clean
- `npx eslint src/app/copilot` - clean
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` - 16/16 passing
- `npx ng build --configuration development` - succeeded

## Files changed

- `src/app/copilot/services/chat.service.ts` (implemented, was previously a `throw new Error('Not implemented')` stub)
- `src/app/copilot/services/chat.service.spec.ts` (new)

Single commit on the branch: `feat(copilot): implement ChatService message orchestration and history`.
