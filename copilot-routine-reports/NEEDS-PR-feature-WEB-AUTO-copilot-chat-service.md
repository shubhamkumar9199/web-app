# NEEDS-PR: feature/WEB-AUTO-copilot-chat-service

Date: 2026-07-09

## Status

The branch `feature/WEB-AUTO-copilot-chat-service` is pushed to
`shubhamkumar9199/web-app` and is ready for a PR against `openMF/web-app:dev`,
but this session's GitHub access is scoped to `shubhamkumar9199/web-app`
only - the `create_pull_request` call against `openMF/web-app` was denied
("repository not configured for this session"). A human (or a session with
broader repo access) needs to open the PR manually.

Note: this branch already existed from an earlier run (commit dated
2026-07-05) with the same `ChatService` implementation, but no PR had ever
been opened for it. Rather than duplicate the work, this run verified the
existing implementation (prettier/eslint/jest/`ng build` all green),
rebased it onto the current `dev` (which had moved on since - the old
branch base was stale, so a raw diff against `dev` showed many unrelated
files), and force-pushed the rebased single commit back onto the same
branch name so the diff is now scoped to just the two Copilot files.

## Ready-to-use PR

**Repo:** openMF/web-app
**Base:** dev
**Head:** shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service

**Title:**

```
WEB-AUTO: Implement ChatService orchestration and history persistence for Copilot
```

**Body:**

```markdown
## Description

Implements `ChatService` (`src/app/copilot/services/chat.service.ts`), the orchestration layer for the Mifos Copilot chat panel. It wires together the pieces already merged in earlier PRs (#3696, #3678, #3675) into a working conversation flow:

- `sendMessage()` runs the input through `InputSanitizer`, appends the user message and a streaming assistant placeholder, then subscribes to `McpClientService.sendMessage()` and applies each `token` / `tool_call` / `action_card` / `error` event to the live message list.
- Tool calls are routed through `McpClientService.handleToolCall()`; a throwing handler does not break the stream.
- On completion, the accumulated text is run through `ResponseParser` to extract any fenced `action_card`/`suggest` blocks and merge them with explicitly-emitted `action_card` events.
- `stopStreaming()` unsubscribes the active stream and clears the streaming indicator; `clearChat()` resets the conversation.
- `loadHistory()` fetches saved conversations from `GET {mcpBaseUrl}/api/chat/history/{userId}` and falls back to a localStorage cache when the MCP server is unreachable or there is no authenticated user.

Note: this branch previously existed with the same implementation but no PR had been opened for it; it has now been rebased onto the current `dev` (which had moved on since) so the diff here is scoped to just these two files.

## Related issues and discussion

Part of the Mifos Copilot roadmap (follow-up to #3648, #3696). No Jira/WEB ticket has been created for this specific item yet - needs a WEB-XXXX ID assigned.

Also note: `core/mcp-client.ts` and `services/mcp-client.service.ts` (the actual SSE transport) remain unimplemented on `dev` - the MCP server's wire contract (endpoint, auth, event schema) is not yet documented anywhere in the repo, so that piece is intentionally left for a follow-up once the contract is finalized. `ChatService` is written against the existing `McpClientService`/`McpStreamEvent` interfaces so no changes will be needed here once that lands.

## Screenshots, if any

N/A - service-layer change, no UI.

## Verification

- `npx prettier --check src/app/copilot` - clean
- `npx eslint src/app/copilot` - clean
- `npx jest --config jest.config.ts src/app/copilot` - 6 suites / 62 tests pass (11 for `ChatService`)
- `npx ng build --configuration development` - succeeds

## Checklist

- [x] If you have multiple commits please combine them into one commit by squashing them.
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
```

## Next steps

1. Open the PR above manually (or from a session with `openMF/web-app` write access).
2. Get a WEB-XXXX Jira ID assigned and update the title/branch naming to match convention if the maintainers require it.
3. Once merged, the next roadmap item is `core/mcp-client.ts` + `services/mcp-client.service.ts` (still blocked on the SSE contract - see `BLOCKED-mcp.md`), then panel wiring to swap the mock `respondMock()` in `copilot-panel.component.ts` for the real `ChatService`.
