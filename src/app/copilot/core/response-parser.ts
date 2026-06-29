/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { McpResponse } from './models/mcp-response.model';
import { ActionCard, ActionCardType } from './models/action-card.model';

const ACTION_CARD_FENCE = /```action-card\s*([\s\S]*?)```/g;
const SUGGESTIONS_FENCE = /```suggestions\s*([\s\S]*?)```/g;

const VALID_CARD_TYPES = new Set<ActionCardType>([
  'client',
  'loan',
  'savings',
  'insight',
  'confirmation'
]);

/**
 * Parses raw MCP/LLM output into structured action cards and follow-ups.
 * Must degrade gracefully on malformed or partial responses - never throw
 * to the UI. Pure logic, see response-parser.spec.ts.
 *
 * Expected stream format:
 *   Prose text ...
 *
 *   ```action-card
 *   { "type": "client", "title": "...", "data": { "key": "value" } }
 *   ```
 *
 *   ```suggestions
 *   ["Follow-up A", "Follow-up B"]
 *   ```
 */
export class ResponseParser {
  /** Extract action-card tokens from a completed response body. */
  parseCards(raw: string): ActionCard[] {
    if (!raw) {
      return [];
    }
    const cards: ActionCard[] = [];
    const pattern = new RegExp(ACTION_CARD_FENCE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      try {
        const parsed: unknown = JSON.parse(match[1].trim());
        if (this.isValidCard(parsed)) {
          cards.push(parsed);
        }
      } catch {
        // skip malformed JSON blocks
      }
    }
    return cards;
  }

  /** Extract suggested follow-up prompts. */
  parseSuggestions(raw: string): string[] {
    if (!raw) {
      return [];
    }
    const pattern = new RegExp(SUGGESTIONS_FENCE.source, 'g');
    const match = pattern.exec(raw);
    if (!match) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
      }
    } catch {
      // skip malformed suggestions block
    }
    return [];
  }

  /** Assemble a full response object from accumulated stream text. */
  parse(raw: string): McpResponse {
    if (!raw) {
      return { text: '', actionCards: [], suggestedPrompts: [] };
    }
    const actionCards = this.parseCards(raw);
    const suggestedPrompts = this.parseSuggestions(raw);
    const text = raw
      .replace(new RegExp(ACTION_CARD_FENCE.source, 'g'), '')
      .replace(new RegExp(SUGGESTIONS_FENCE.source, 'g'), '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, actionCards, suggestedPrompts };
  }

  private isValidCard(obj: unknown): obj is ActionCard {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    const card = obj as Record<string, unknown>;
    return (
      VALID_CARD_TYPES.has(card['type'] as ActionCardType) &&
      typeof card['title'] === 'string' &&
      card['title'].trim().length > 0 &&
      typeof card['data'] === 'object' &&
      card['data'] !== null &&
      !Array.isArray(card['data'])
    );
  }
}
