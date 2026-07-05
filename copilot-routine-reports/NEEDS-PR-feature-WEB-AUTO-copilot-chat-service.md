# NEEDS-PR: feature/WEB-AUTO-copilot-chat-service

Date: 2026-07-05

## Why this note exists

The branch below is implemented, tested green, and pushed to the fork. The
PR itself could not be opened because this session's GitHub access is scoped
to `shubhamkumar9199/web-app` only; the GitHub MCP server explicitly denied
a `create_pull_request` call targeting `openMF/web-app`:

```
Access denied: repository "openmf/web-app" is not configured for this session.
Allowed repositories: shubhamkumar9199/web-app
```

Someone with `openMF/web-app` access needs to open the PR manually (or grant
this session write access to `openMF/web-app` for future runs).

## Ready PR

- **Repo:** `openMF/web-app`
- **Base:** `dev`
- **Head:** `shubhamkumar9199:feature/WEB-AUTO-copilot-chat-service`
- **Branch pushed to fork:** yes (`origin/feature/WEB-AUTO-copilot-chat-service`)

### Title

```
feat(copilot): implement ChatService orchestration and history persistence
```

### Body

```markdown
## Description

Implements `ChatService` (`src/app/copilot/services/chat.service.ts`), the next unimplemented item on the Mifos Copilot roadmap. It wires the orchestration pipeline described in the class's own doc comment: sanitize the user's text, save the user message, stream the reply through `McpClientService`, parse the assembled text for `action_card`/`suggest` fenced blocks via `ResponseParser`, and persist the conversation.

- `sendMessage()`: sanitizes input via `InputSanitizer`; blocked input (too long, or a prompt-injection pattern) appends a `system` role notice instead of calling MCP. Otherwise it appends a streaming `assistant` message, subscribes to `McpClientService.sendMessage()`, and updates that message live as `token` events arrive.
- `tool_call` events are routed to `McpClientService.handleToolCall()` (wrapped defensively since that method is still a stub pending the MCP transport work) and recorded as `toolUsed` on the final message.
- `action_card` events are merged with any `action_card` fenced blocks recovered from the assembled text by `ResponseParser`.
- `stopStreaming()` cancels the active subscription and finalizes the message with whatever content had streamed in so far.
- `clearChat()` resets the message list and starts a fresh session id.
- `loadHistory()` calls `GET {mcpBaseUrl}/api/chat/history/{userId}` (the endpoint shape already documented in the pre-existing TODO comment) and falls back to a `localStorage` cache on any request failure or when there's no logged-in user id.

Note: `core/mcp-client.ts` and `services/mcp-client.service.ts` (the actual SSE transport, roadmap item ahead of this one) are intentionally left as-is - the wire contract (endpoint framing, auth, retry semantics) isn't documented anywhere in the repo yet, so `ChatService` is written against the two services' existing TypeScript interfaces and unit-tested with a mocked `McpClientService`. See `copilot-routine-reports/BLOCKED-mcp.md` for why that item was skipped this run.

A WEB Jira number still needs to be assigned to this change.

## Related issues and discussion

#{Issue Number}

## Screenshots, if any

N/A - this is a service-layer change with no template; behavior is covered by the added unit tests.

## Verification summary

- `npx prettier --write` - clean
- `npx eslint` - clean
- `npx jest --config jest.config.ts src/app/copilot/services/chat.service.spec.ts` - 18/18 passing (happy-path streaming, sanitizer blocking, action-card/suggestion parsing, tool_call routing incl. defensive handling of the still-unimplemented `handleToolCall`, in-band/transport error handling, stopStreaming, clearChat, and loadHistory's remote/localStorage-fallback/no-user paths)
- `npx ng build --configuration development` - builds successfully

## Checklist

- [x] If you have multiple commits please combine them into one commit by squashing them.
- [x] Read and understood the contribution guidelines at `web-app/.github/CONTRIBUTING.md`.
```
