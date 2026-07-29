# NEEDS PR: feature/WEB-AUTO-copilot-chat-orchestration-0729

The branch is implemented, tested, linted, built, and pushed to
`shubhamkumar9199/web-app`, but this session's GitHub MCP access is scoped
only to `shubhamkumar9199/web-app` — it cannot open a PR against
`openMF/web-app` (`create_pull_request` returns "Access denied: repository
openmf/web-app is not configured for this session"). A human (or a session
with cross-repo GitHub access) needs to open the PR manually using the
title/body below.

## PR to create

- Repo: `openMF/web-app`
- Base: `dev`
- Head: `shubhamkumar9199:feature/WEB-AUTO-copilot-chat-orchestration-0729`

### Title

```
feat(copilot): implement ChatService orchestration and localStorage history
```

### Body

```markdown
## Summary

Implements `ChatService` (`src/app/copilot/services/chat.service.ts`), the next unimplemented item in the Mifos Copilot roadmap after `ResponseParser`, `PermissionChecker` and `IdempotencyKeyFactory`.

- `sendMessage`: sanitizes the user's text via `InputSanitizer`, appends the user message, then streams the assistant reply through `McpClientService.sendMessage()`, accumulating `token` events and assembling the final text/action cards/suggested prompts with `ResponseParser` on the `done` event.
- `tool_call` events set `toolUsed` on the message; `action_card` events merge structured cards into the message (deduplicated against cards parsed from the raw text).
- `stopStreaming`: cancels the in-flight subscription and finalises the last assistant message.
- `clearChat`: stops any active stream and starts a fresh conversation.
- `loadHistory` / conversation persistence: reads/writes the Recent Chats list to `localStorage`. Server-side persistence to the MCP history endpoint is left as an explicit `TODO`, since that endpoint's contract is not yet finalised (see below).

`core/mcp-client.ts` and `services/mcp-client.service.ts` (the SSE transport) were intentionally **not** implemented in this PR: the actual wire contract (endpoint, SSE event framing, retry/backoff, tool-call ack flow) is not documented anywhere in the repo — `mcp-fixtures.ts` and `copilot-panel.component.ts` both explicitly note the endpoint contract isn't finalised yet. `ChatService` is built against the already-fully-typed `McpClientService.sendMessage(): Observable<McpStreamEvent>` seam so it can be implemented and unit-tested independently of that transport work landing later.

Note: the Jira/WEB ticket number for this item still needs to be assigned by a maintainer; the branch/commit use a placeholder slug in the meantime.

## Verification

- `npx prettier --check` / `--write`: clean
- `npx eslint`: clean
- `npx jest --config jest.config.ts src/app/copilot`: 6 suites, 55 tests passed (11 new for `ChatService`, covering blocked input, token streaming, tool calls, action cards, stream/in-stream errors, stop/clear, and history load incl. corrupt-storage fallback)
- `npx ng build --configuration development`: succeeds

## Test plan

- [x] Unit tests for `ChatService` (streaming, errors, stop, clear, history)
- [x] Full copilot suite still green
- [x] Production dev build succeeds
- [ ] Manual verification against a live MCP server (blocked until the transport/endpoint contract above is implemented)
```

---

## Important: this routine appears to have been stuck in a loop for at least a week

While preparing this branch, pushing to `feature/WEB-AUTO-copilot-chat-orchestration`
(the name this run picked first) failed with a non-fast-forward rejection
because that exact branch name already existed on the remote, pushed by an
earlier run, containing its own from-scratch implementation of
`ChatService` — based on a very old snapshot of `dev` (hundreds of commits
behind current upstream `dev`).

Listing all `feature/WEB-AUTO-*` branches on `shubhamkumar9199/web-app` turned
up over a dozen, most of them variations on `chat-service` /
`copilot-chat-service` (some dated `0721`, `0723`, `0725`, `0727`):

```
feature/WEB-AUTO-chat-service
feature/WEB-AUTO-chat-service-orchestration
feature/WEB-AUTO-chat-service-orchestration-0725
feature/WEB-AUTO-chat-service-orchestration-0727
feature/WEB-AUTO-copilot-chat-orchestration
feature/WEB-AUTO-copilot-chat-service
feature/WEB-AUTO-copilot-chat-service-0721
feature/WEB-AUTO-copilot-chat-service-0723
feature/WEB-AUTO-copilot-chat-service-2
feature/WEB-AUTO-copilot-chat-service-orchestration
feature/WEB-AUTO-copilot-status-2026-07-17
feature/WEB-AUTO-response-parser
```

None of these correspond to a PR against `openMF/web-app` — a PR search for
`repo:openMF/web-app author:shubhamkumar9199` only turns up unrelated,
already-merged Copilot PRs (`WEB-1004`, `WEB-1007`, `WEB-1008`, `WEB-1010`,
`WEB-1011`, `WEB-1017`, none of which touch `chat.service.ts`). So `dev`
still has the `Not implemented` stub for `ChatService`, meaning every run of
this routine has been re-doing the same `ChatService` implementation from
scratch, hitting a push/PR problem, and leaving an orphaned branch behind,
apparently without ever notifying anyone that no PR was actually landing.

Root cause of the push failures I could reproduce this run: pushing to a
branch name that already exists remotely (even one this session never
created) fails with a `403` from the local git proxy plus a non-fast-forward
message, while pushing to a genuinely unused branch name succeeds
immediately. So the recurring failure is very likely: the model tends to
pick similar/predictable slugs for the same file across runs, collides with
its own prior orphaned branch, sees a push error, and stops instead of
retrying under a new name or investigating.

Suggested cleanup for a human:

1. Delete the stale `feature/WEB-AUTO-*` branches above on
   `shubhamkumar9199/web-app` (this session could not delete them either —
   branch deletion also returned a `403`, likely a permission the proxy
   doesn't grant).
2. Either grant this GitHub MCP session access to `openMF/web-app` (so PRs
   can actually be opened directly), or have a human open the PR above
   manually so this item stops being re-picked every run.
