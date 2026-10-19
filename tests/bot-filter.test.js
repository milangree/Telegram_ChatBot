// tests/bot-filter.test.js
import { describe, it, expect } from 'vitest';
import {
  getMessageFilterRules,
  findBlockedRuleForMessage,
  parseMessageFilterInput,
} from '../functions/_shared/bot-filter.js';
import {
  normalizeMessageFilterRule,
  parseMessageFilterRules,
  serializeMessageFilterRules,
} from '../shared/message-filters.js';

describe('bot-filter.js', () => {
  describe('parseMessageFilterRules', () => {
    it('should parse empty rules', () => {
      expect(parseMessageFilterRules('[]')).toEqual([]);
      expect(parseMessageFilterRules('')).toEqual([]);
      expect(parseMessageFilterRules(null)).toEqual([]);
    });

    it('should parse valid rules', () => {
      const rules = [{ type: 'text', value: 'spam', id: 'rule1' }];
      const json = JSON.stringify(rules);
      expect(parseMessageFilterRules(json)).toEqual(rules);
    });
  });

  describe('serializeMessageFilterRules', () => {
    it('should serialize rules to JSON', () => {
      const rules = [{ type: 'text', value: 'spam', id: 'rule1' }];
      const json = serializeMessageFilterRules(rules);
      expect(JSON.parse(json)).toEqual(rules);
    });
  });

  describe('normalizeMessageFilterRule', () => {
    it('should normalize text rule', () => {
      const rule = { type: 'text', value: 'spam' };
      const normalized = normalizeMessageFilterRule(rule);
      expect(normalized.type).toBe('text');
      expect(normalized.value).toBe('spam');
      expect(normalized.id).toBeDefined();
    });

    it('should normalize regex rule', () => {
      const rule = { type: 'regex', value: 'spam.*' };
      const normalized = normalizeMessageFilterRule(rule);
      expect(normalized.type).toBe('regex');
      expect(normalized.value).toBe('/spam.*/');
    });
  });

  describe('findBlockedRuleForMessage', () => {
    it('should return null when no rules match', () => {
      const settings = { MESSAGE_FILTER_RULES: '[]' };
      const msg = { text: 'hello world' };
      expect(findBlockedRuleForMessage(settings, msg)).toBeNull();
    });

    it('should find matching text rule', () => {
      const rules = [{ type: 'text', value: 'spam', id: 'rule1' }];
      const settings = { MESSAGE_FILTER_RULES: JSON.stringify(rules) };
      const msg = { text: 'this is spam message' };
      const matched = findBlockedRuleForMessage(settings, msg);
      expect(matched).not.toBeNull();
    });

    it('should find matching regex rule', () => {
      const rules = [{ type: 'regex', value: 'spam.*', id: 'rule2' }];
      const settings = { MESSAGE_FILTER_RULES: JSON.stringify(rules) };
      const msg = { text: 'spam message' };
      const matched = findBlockedRuleForMessage(settings, msg);
      expect(matched).not.toBeNull();
    });
  });

  describe('parseMessageFilterInput', () => {
    it('should parse text input', () => {
      const result = parseMessageFilterInput('text spam');
      expect(result).toEqual({ type: 'text', value: 'spam' });
    });

    it('should parse regex input', () => {
      const result = parseMessageFilterInput('regex spam.*');
      expect(result).toEqual({ type: 'regex', value: 'spam.*' });
    });

    it('should handle input without type prefix', () => {
      const result = parseMessageFilterInput('spam');
      expect(result).toEqual({ type: 'text', value: 'spam' });
    });

    it('should return null for empty input', () => {
      expect(parseMessageFilterInput('')).toBeNull();
      expect(parseMessageFilterInput(null)).toBeNull();
    });
  });
});
