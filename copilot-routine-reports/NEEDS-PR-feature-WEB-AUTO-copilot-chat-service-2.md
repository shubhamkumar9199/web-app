# NEEDS PR: feature/WEB-AUTO-copilot-chat-service-2

Date: 2026-07-13

## Why this is a note instead of an opened PR

The branch `feature/WEB-AUTO-copilot-chat-service-2` is pushed to
`shubhamkumar9199/web-app`, but this session's GitHub MCP access is scoped
to `shubhamkumar9199/web-app` only. Calling `create_pull_request` (or
`list_pull_requests`) against `openMF/web-app` returns:

```
Access denied: repository "openmf/web-app" is not configured for this
session. Allowed repositories: shubhamkumar9199/web-app
```

(`search_pull_requests` against `openMF/web-app` does work in this
session, which is how the duplicate-branch check below was done - only
the write/list-by-head paths are blocked.)

## Ready-to-open PR

- **Repo**: `openMF/web-app`
- **Base**: `dev`
- **Head**: `shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service-2`
- **Title**: `WEB-XXXX: Implement ChatService orchestration and history for Mifos Copilot`

**Body:**

> ## Description
>
> Implements item 5 of the Mifos Copilot roadmap:
> `src/app/copilot/services/chat.service.ts`, which previously threw
> `Not implemented` in all four of its public methods.
>
> `ChatService` now orchestrates a chat turn end-to-end against the
> existing (already-merged) Copilot building blocks:
>
> - `sendMessage(content)`: runs the message through `InputSanitizer`
>   first; a blocked message (too long/empty, or a known
>   prompt-injection phrasing) is surfaced as a `system` chat message
>   and never reaches the transport. Otherwise it appends the user
>   message plus a streaming assistant placeholder, fetches the current
>   `CopilotContext` from `AiContextService`, and subscribes to
>   `McpClientService.sendMessage(...)`. Stream events are handled per
>   the existing `McpStreamEvent` contract: `token` appends to the
>   assistant message, `tool_call` delegates to
>   `McpClientService.handleToolCall` and records `toolUsed`,
>   `action_card` appends the structured card, and `done` finalizes the
>   message (extracting any `suggest` follow-up prompts via the
>   existing `ResponseParser`) and records the turn into
>   `conversations$`/localStorage for the Recent Chats tab.
> - `stopStreaming()`: unsubscribes the in-flight stream and marks the
>   assistant message as no longer streaming.
> - `clearChat()`: resets the message list and starts a new conversation
>   id.
> - `loadHistory()`: `GET {mcpBaseUrl}/api/chat/history/{loggedInUser}`,
>   falling back to a cached localStorage copy (and finally an empty
>   list) if the request fails, matching the TODO already present in
>   the stub.
>
> Note: item 4 on the roadmap (`core/mcp-client.ts` +
> `services/mcp-client.service.ts`, the actual SSE transport) is
> intentionally left unimplemented for now - the SSE/tool-call contract
> isn't documented anywhere in the repo yet (see the `mcp-fixtures.ts`
> TODO noting the endpoint contract isn't finalized). `ChatService` is
> built and unit-tested entirely against the existing `McpClientService`
> interface via dependency injection, so it can be wired to the real
> transport as a drop-in once that contract lands, without further
> changes to this file.
>
> No changes outside `src/app/copilot`.
>
> ## Related issues and discussion
>
> Part of the Mifos Copilot feature roadmap (Jira WEB number for this
> specific item needs to be assigned by a maintainer; prior roadmap
> items landed as WEB-1004, WEB-1007, WEB-1008, WEB-1010, WEB-1011, and
> WEB-1017).
>
> ## Screenshots, if any
>
> N/A - this is a service-layer change with no template/UI changes.
>
> ## Verification summary
>
> - `npx prettier --write` - clean
> - `npx eslint` - clean
> - `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts`
>   - 13/13 tests passing, covering: input-gate blocking (length +
>     injection), full happy-path streaming (tokens/tool_call/action_card/done),
>     suggestion extraction, Recent-Chats persistence, stream-error and
>     synchronous-throw graceful degradation, `stopStreaming` unsubscribe
>     behavior, `clearChat` session reset, and `loadHistory`
>     success/fallback/empty paths (via `HttpClientTestingModule`).
> - `npx ng build --configuration development` - builds successfully
>   (one pre-existing, unrelated `NG8113` warning on
>   `ReportingDashboardComponent`).
>
> ## Checklist
>
> - [x] Single commit (squashed).
> - [x] Read and understood the contribution guidelines at
>       `web-app/.github/CONTRIBUTING.md`.

## Note on a stale duplicate branch

`origin/feature/WEB-AUTO-copilot-chat-service` (no `-2` suffix) already
existed before this run, pushed by an earlier routine run on 2026-07-05,
with a single commit implementing essentially the same thing. It was
never turned into a PR (`search_pull_requests` against
`openMF/web-app` for `head:feature/WEB-AUTO-copilot-chat-service` and
the `-orchestration` variant both return zero results), and it forked
from a much older point in `dev`'s history. Rather than force-push over
unreviewed history on a branch I can't fully vouch for, this run's work
was pushed under the `-2` suffix instead. Once a maintainer opens the PR
above, the old `feature/WEB-AUTO-copilot-chat-service` and
`feature/WEB-AUTO-chat-service` / `feature/WEB-AUTO-chat-service-orchestration`
branches can likely be deleted as abandoned duplicates - left untouched
here since deleting branches wasn't part of this run's scope.
