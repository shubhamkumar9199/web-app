/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ResponseParser } from './response-parser';
import { ActionCard } from './models/action-card.model';

const CLIENT_CARD: ActionCard = {
  type: 'client',
  title: 'Ravi Patil',
  data: { 'Client ID': '1001', Status: 'Active' }
};

const LOAN_CARD: ActionCard = {
  type: 'loan',
  title: 'Loan #2050',
  data: { Principal: '50000', Status: 'Active' },
  actions: [{ label: 'View', style: 'primary', route: '/loans/2050' }]
};

function fenceCard(card: ActionCard): string {
  return `\`\`\`action-card\n${JSON.stringify(card)}\n\`\`\``;
}

function fenceSuggestions(items: string[]): string {
  return `\`\`\`suggestions\n${JSON.stringify(items)}\n\`\`\``;
}

describe('ResponseParser', () => {
  let parser: ResponseParser;

  beforeEach(() => {
    parser = new ResponseParser();
  });

  // ── parseCards ────────────────────────────────────────────────────────────

  describe('parseCards', () => {
    it('returns empty array for empty input', () => {
      expect(parser.parseCards('')).toEqual([]);
    });

    it('returns empty array for null-ish input', () => {
      expect(parser.parseCards(undefined as unknown as string)).toEqual([]);
    });

    it('returns empty array when no fences are present', () => {
      expect(parser.parseCards('Here is some plain text response.')).toEqual([]);
    });

    it('extracts a single valid action card', () => {
      const raw = `Some text.\n\n${fenceCard(CLIENT_CARD)}\n\nMore text.`;
      expect(parser.parseCards(raw)).toEqual([CLIENT_CARD]);
    });

    it('extracts multiple action cards', () => {
      const raw = `${fenceCard(CLIENT_CARD)}\n\n${fenceCard(LOAN_CARD)}`;
      expect(parser.parseCards(raw)).toEqual([
        CLIENT_CARD,
        LOAN_CARD
      ]);
    });

    it('skips a card with malformed JSON without throwing', () => {
      const raw = '```action-card\n{broken json\n```';
      expect(() => parser.parseCards(raw)).not.toThrow();
      expect(parser.parseCards(raw)).toEqual([]);
    });

    it('skips a card whose type is not a known ActionCardType', () => {
      const bad = { type: 'unknown', title: 'X', data: {} };
      const raw = `\`\`\`action-card\n${JSON.stringify(bad)}\n\`\`\``;
      expect(parser.parseCards(raw)).toEqual([]);
    });

    it('skips a card missing the required title field', () => {
      const bad = { type: 'client', data: { id: '1' } };
      const raw = `\`\`\`action-card\n${JSON.stringify(bad)}\n\`\`\``;
      expect(parser.parseCards(raw)).toEqual([]);
    });

    it('skips a card missing the data field', () => {
      const bad = { type: 'client', title: 'X' };
      const raw = `\`\`\`action-card\n${JSON.stringify(bad)}\n\`\`\``;
      expect(parser.parseCards(raw)).toEqual([]);
    });

    it('skips a card where data is an array (must be a plain object)', () => {
      const bad = { type: 'client', title: 'X', data: [
          'a',
          'b'
        ] };
      const raw = `\`\`\`action-card\n${JSON.stringify(bad)}\n\`\`\``;
      expect(parser.parseCards(raw)).toEqual([]);
    });

    it('preserves the actions array when present', () => {
      const raw = fenceCard(LOAN_CARD);
      const cards = parser.parseCards(raw);
      expect(cards[0].actions).toEqual(LOAN_CARD.actions);
    });

    it('returns an empty array on completely garbage input', () => {
      expect(parser.parseCards('!@#$%^&*()')).toEqual([]);
    });
  });

  // ── parseSuggestions ──────────────────────────────────────────────────────

  describe('parseSuggestions', () => {
    it('returns empty array for empty input', () => {
      expect(parser.parseSuggestions('')).toEqual([]);
    });

    it('returns empty array for null-ish input', () => {
      expect(parser.parseSuggestions(undefined as unknown as string)).toEqual([]);
    });

    it('returns empty array when no suggestions fence is present', () => {
      expect(parser.parseSuggestions('Plain text response.')).toEqual([]);
    });

    it('extracts a list of suggestion strings', () => {
      const items = [
        'Check loan status',
        'View savings account',
        'List active clients'
      ];
      const raw = `Some text.\n\n${fenceSuggestions(items)}`;
      expect(parser.parseSuggestions(raw)).toEqual(items);
    });

    it('filters out non-string entries in the suggestions array', () => {
      const raw = `\`\`\`suggestions\n${JSON.stringify([
        'valid',
        42,
        null,
        'also valid'
      ])}\n\`\`\``;
      expect(parser.parseSuggestions(raw)).toEqual([
        'valid',
        'also valid'
      ]);
    });

    it('filters out blank-string entries', () => {
      const raw = `\`\`\`suggestions\n${JSON.stringify([
        'ok',
        '  ',
        '',
        'good'
      ])}\n\`\`\``;
      expect(parser.parseSuggestions(raw)).toEqual([
        'ok',
        'good'
      ]);
    });

    it('returns empty array on malformed JSON in the fence without throwing', () => {
      const raw = '```suggestions\n[not valid json\n```';
      expect(() => parser.parseSuggestions(raw)).not.toThrow();
      expect(parser.parseSuggestions(raw)).toEqual([]);
    });

    it('returns empty array when the fence contains a non-array JSON value', () => {
      const raw = '```suggestions\n{"key": "value"}\n```';
      expect(parser.parseSuggestions(raw)).toEqual([]);
    });
  });

  // ── parse ─────────────────────────────────────────────────────────────────

  describe('parse', () => {
    it('returns an empty McpResponse for empty input', () => {
      expect(parser.parse('')).toEqual({ text: '', actionCards: [], suggestedPrompts: [] });
    });

    it('returns an empty McpResponse for null-ish input', () => {
      expect(parser.parse(undefined as unknown as string)).toEqual({
        text: '',
        actionCards: [],
        suggestedPrompts: []
      });
    });

    it('returns plain text with no cards or suggestions', () => {
      const result = parser.parse('Here is your account summary.');
      expect(result.text).toBe('Here is your account summary.');
      expect(result.actionCards).toEqual([]);
      expect(result.suggestedPrompts).toEqual([]);
    });

    it('strips the card fence from the text output', () => {
      const raw = `Here is the client.\n\n${fenceCard(CLIENT_CARD)}\n\nEnd.`;
      const result = parser.parse(raw);
      expect(result.text).toContain('Here is the client.');
      expect(result.text).toContain('End.');
      expect(result.text).not.toContain('action-card');
    });

    it('strips the suggestions fence from the text output', () => {
      const raw = `Summary.\n\n${fenceSuggestions(['Next step A'])}`;
      const result = parser.parse(raw);
      expect(result.text).toBe('Summary.');
      expect(result.text).not.toContain('suggestions');
    });

    it('assembles text, cards and suggestions from a full response', () => {
      const suggestions = [
        'View loans',
        'Check savings'
      ];
      const raw = [
        'I found the client you were looking for.',
        '',
        fenceCard(CLIENT_CARD),
        '',
        fenceSuggestions(suggestions)
      ].join('\n');

      const result = parser.parse(raw);
      expect(result.text).toContain('I found the client');
      expect(result.actionCards).toEqual([CLIENT_CARD]);
      expect(result.suggestedPrompts).toEqual(suggestions);
    });

    it('handles multiple cards in one response', () => {
      const raw = `Overview.\n\n${fenceCard(CLIENT_CARD)}\n\n${fenceCard(LOAN_CARD)}`;
      const result = parser.parse(raw);
      expect(result.actionCards).toHaveLength(2);
    });

    it('never throws on completely garbage input', () => {
      expect(() => parser.parse('!@#$%^&*()\n```broken\njunk\n```')).not.toThrow();
    });

    it('collapses excess blank lines left after removing fences', () => {
      const raw = `Line one.\n\n\n\n${fenceCard(CLIENT_CARD)}\n\n\n\nLine two.`;
      const result = parser.parse(raw);
      expect(result.text).not.toMatch(/\n{3,}/);
    });
  });
});
