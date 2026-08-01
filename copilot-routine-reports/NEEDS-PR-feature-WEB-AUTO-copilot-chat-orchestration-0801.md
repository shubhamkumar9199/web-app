# NEEDS PR: feature/WEB-AUTO-copilot-chat-orchestration-0801

The branch is implemented, tested, linted, built, and pushed to
`shubhamkumar9199/web-app`, but this session's GitHub MCP access is scoped
only to `shubhamkumar9199/web-app` — `create_pull_request` against
`openMF/web-app` returns:

```
Access denied: repository "openmf/web-app" is not configured for this session. Allowed repositories: shubhamkumar9199/web-app
```

A human (or a session with cross-repo GitHub access) needs to open the PR
manually using the title/body below.

## PR to create

- Repo: `openMF/web-app`
- Base: `dev`
- Head: `shubhamkumar9199:feature/WEB-AUTO-copilot-chat-orchestration-0801`

### Title

```
feat(copilot): implement ChatService conversation orchestration and history
```

### Body

```markdown
## Description

Implements `src/app/copilot/services/chat.service.ts`, the next unimplemented
item on the Mifos Copilot roadmap (`throw new Error('Not implemented')`
removed from all four methods).

`ChatService` now orchestrates a full conversation turn:

- `sendMessage`: runs the input through `InputSanitizer`, appends the user +
  a streaming assistant message, subscribes to
  `McpClientService.sendMessage(...)`, and routes `token` / `tool_call` /
  `action_card` / `error` / `done` events into the live message via
  `messages$`. Fenced `action_card` / `suggest` blocks in the final text are
  parsed with `ResponseParser`. Both a synchronous throw and an observable
  error from the (still-unimplemented) MCP client are caught so the UI
  degrades gracefully with a fallback error message instead of throwing.
- `stopStreaming`: unsubscribes the in-flight stream and marks the last
  assistant message as no longer streaming.
- `clearChat`: resets the message list and starts a new conversation id.
- `loadHistory`: fetches `GET {mcpBaseUrl}/api/chat/history/{userId}`,
  falling back to a `localStorage`-persisted history
  (`copilot_chat_history`) when there's no logged-in user or the request
  fails. Every completed turn is also saved to that local history so Recent
  Chats has data before the server-side history endpoint exists.

**Roadmap item skipped this run:** item 4, `core/mcp-client.ts` +
`services/mcp-client.service.ts` (the SSE transport), was intentionally left
unimplemented — the SSE/tool-call wire contract isn't documented anywhere in
the repo yet. See `copilot-routine-reports/BLOCKED-mcp.md` for details.

**Jira/WEB ticket:** this item does not yet have a WEB-#### ticket assigned.
Please assign one and I'll update the title/commit if needed.

## Related issues and discussion

Follow-up to #3696 (WEB-1017: Copilot core services and confirmation dialog).

## Screenshots, if any

N/A — service-layer change, no UI wiring in this PR.

## Verification summary

- `npx prettier --write` — clean
- `npx eslint src/app/copilot/services/chat.service.ts src/app/copilot/services/chat.service.spec.ts` — no errors
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` — 13/13 passing (sanitizer rejection, streaming tokens/action-card/tool-call, fenced-block parsing, server + transport error handling, synchronous-throw recovery, stop/clear, remote history load + localStorage fallback + no-user path)
- `npx ng build --configuration development` — builds successfully (one pre-existing, unrelated `NG8113` warning on `DisputeManagementComponent`)

## Checklist

- [x] Single commit (squashed).
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
```

## This is a recurring, systemic blocker — not a one-off

This exact "implemented and pushed, but cannot open the PR" outcome has now
happened repeatedly over at least the past week, for this same roadmap item.
Evidence gathered this run:

- The `shubhamkumar9199/web-app` fork carries **over a dozen** orphaned
  `feature/WEB-AUTO-*` branches for this same `chat.service.ts` item,
  dated back to at least `0721`: `chat-service`, `chat-service-orchestration`
  (`-0725`, `-0727`, `-jul31`), `copilot-chat-service` (`-0721`, `-0723`,
  `-2`), `copilot-chat-orchestration` (`-0729`, and now this run's `-0801`),
  `copilot-chat-orchestration-test-unique-9f3k2`, plus `response-parser` and
  a `copilot-status` branch. Each represents a full implementation +
  test + build cycle that never became a PR.
- A prior run's report (`reports/copilot-routine-2026-07-29` branch,
  `NEEDS-PR-feature-WEB-AUTO-copilot-chat-orchestration-0729.md`) already
  flagged this exact same access-scoping problem and asked a human to either
  grant cross-repo access or open the PR manually. As of this run, neither
  has happened: `create_pull_request` against `openMF/web-app` still returns
  "Access denied", and `search_pull_requests` for
  `repo:openMF/web-app author:shubhamkumar9199` still shows no PR touching
  `chat.service.ts` — only the earlier, unrelated, already-merged Copilot
  PRs (WEB-1004/1007/1008/1010/1011/1017).
- None of these report branches (`copilot-routine-reports/2026-07-13`,
  `.../2026-07-23`, `.../2026-07-25`, `reports/copilot-routine-2026-07-27`,
  `reports/copilot-routine-2026-07-29`, and now this one) were ever merged
  or otherwise surfaced anywhere a human would routinely look — they are
  orphan branches on the fork, so the flagged blocker has been silently
  re-discovered and re-reported every run without anyone acting on it.

**This run is sending a proactive notification** about this instead of
silently repeating the cycle. Recommended fixes (either would unblock this):

1. Grant this automation's GitHub session write/PR-creation access to
   `openMF/web-app` (not just its own fork), so it can open PRs directly; or
2. Have a human open the PR above manually from
   `shubhamkumar9199:feature/WEB-AUTO-copilot-chat-orchestration-0801` once,
   and then delete/archive the stale orphaned branches listed above so this
   item stops being re-implemented from scratch every run.
