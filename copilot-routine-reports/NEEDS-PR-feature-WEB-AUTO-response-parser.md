# NEEDS-PR: feature/WEB-AUTO-response-parser

Branch pushed to `shubhamkumar9199/web-app`. PR cannot be created automatically
because the GitHub MCP server is scoped to the fork only (`shubhamkumar9199/web-app`),
not the upstream (`openMF/web-app`).

## Ready PR details

**Target repo:** openMF/web-app
**Base branch:** dev
**Head:** shubhamkumar9199:feature/WEB-AUTO-response-parser

### Title

```
feat(copilot): implement ResponseParser with graceful degradation
```

### Body

```
## Summary

- Implements `ResponseParser` in `src/app/copilot/core/response-parser.ts`,
  replacing the three `throw new Error('Not implemented')` stubs
- Parses accumulated MCP stream text for fenced `action-card` JSON blocks and
  `suggestions` JSON arrays (standard backtick markdown fences) into `ActionCard[]`
  and `string[]`
- Never throws to the UI -- all malformed JSON, invalid types, missing fields, and
  null/undefined input degrade gracefully to empty arrays or empty McpResponse
- Strips card and suggestion fences from prose text; collapses excess blank lines
- Adds `response-parser.spec.ts` with 29 Jest tests covering happy path,
  multiple cards, all five `ActionCardType` values, malformed JSON, missing fields,
  non-string and blank suggestion filtering, null/undefined input, and garbage input

## Roadmap item

This is item 1 of the Copilot core implementation roadmap. The Jira/WEB ticket
number needs assigning by the team (placeholder: WEB-AUTO).

## Verification

- `npx jest --config jest.config.ts src/app/copilot/core/response-parser.spec.ts`:
  29 tests passed
- `npx eslint src/app/copilot/core/response-parser.ts response-parser.spec.ts`: clean
- `npx ng build --configuration development`: Application bundle generation complete
```
