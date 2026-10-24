/**
 * sk-47.2 — unit tests for the paste-a-blob code extractor.
 *
 * The extractor is the most load-bearing pure function in the feature: it
 * decides whether a paste enters blob mode at all. Coverage here mirrors
 * the behaviour spec — codes extracted, dedupe, hierarchical `.N`,
 * case-insensitivity, and (critically) bare numbers dropped.
 */

import { describe, expect, test } from 'vitest';
import { extractIssueCodes } from '../extractIssueCodes';

describe('extractIssueCodes — basic extraction', () => {
  test('pulls a single code out of prose', () => {
    expect(extractIssueCodes('please look at sk-14 today')).toEqual(['sk-14']);
  });

  test('pulls multiple distinct codes in first-seen order', () => {
    expect(
      extractIssueCodes('sk-14 then demo-2 and finally billing-9'),
    ).toEqual(['sk-14', 'demo-2', 'billing-9']);
  });

  test('extracts codes with no surrounding prose', () => {
    expect(extractIssueCodes('sk-1\nsk-2\nsk-3')).toEqual(['sk-1', 'sk-2', 'sk-3']);
  });

  test('handles comma / punctuation separators', () => {
    expect(extractIssueCodes('sk-1, sk-2; sk-3.')).toEqual(['sk-1', 'sk-2', 'sk-3']);
  });
});

describe('extractIssueCodes — dedupe', () => {
  test('de-duplicates repeated codes, keeping first-seen order', () => {
    expect(
      extractIssueCodes('sk-14 sk-14 demo-2 sk-14 demo-2'),
    ).toEqual(['sk-14', 'demo-2']);
  });

  test('dedupe is case-insensitive (SK-14 and sk-14 collapse)', () => {
    expect(extractIssueCodes('SK-14 and sk-14')).toEqual(['sk-14']);
  });
});

describe('extractIssueCodes — hierarchical .N ids', () => {
  test('extracts a subtask id', () => {
    expect(extractIssueCodes('subtask sk-14.2 is blocked')).toEqual(['sk-14.2']);
  });

  test('extracts deep hierarchical ids', () => {
    expect(extractIssueCodes('see demo-2.1.3 for details')).toEqual(['demo-2.1.3']);
  });

  test('parent and child are distinct codes', () => {
    expect(extractIssueCodes('sk-14 and sk-14.2')).toEqual(['sk-14', 'sk-14.2']);
  });
});

describe('extractIssueCodes — case folding to canonical lowercase', () => {
  test('uppercase + mixed-case codes normalise to lowercase', () => {
    expect(extractIssueCodes('SK-14 Demo-2 BiLLing-9')).toEqual([
      'sk-14',
      'demo-2',
      'billing-9',
    ]);
  });

  test('prefixes with digits/underscore/hyphen are allowed', () => {
    expect(
      extractIssueCodes('proj_2-5 a1b2-7 my-svc-3'),
    ).toEqual(['proj_2-5', 'a1b2-7', 'my-svc-3']);
  });
});

describe('extractIssueCodes — bare numbers are NOT codes', () => {
  test('a stray integer in prose is not extracted', () => {
    expect(extractIssueCodes('there are 15 tasks and 2024 was a year')).toEqual([]);
  });

  test('bare numbers around a real code yield only the code', () => {
    expect(
      extractIssueCodes('15 items, see sk-14, 2024 deadline'),
    ).toEqual(['sk-14']);
  });

  test('a number that is not preceded by a letter-led prefix is dropped', () => {
    // "3-4" has a digit-led "prefix" → the [a-z] anchor rejects it.
    expect(extractIssueCodes('range 3-4 and version 1.2.3')).toEqual([]);
  });

  test('decimals / version strings without a prefix-hyphen are not codes', () => {
    expect(extractIssueCodes('v1.2.3 release at 99.9% done')).toEqual([]);
  });
});

describe('extractIssueCodes — edge cases', () => {
  test('empty / whitespace input → empty array', () => {
    expect(extractIssueCodes('')).toEqual([]);
    expect(extractIssueCodes('   \n\t  ')).toEqual([]);
  });

  test('trailing non-digit after a code does not bleed (sk-14abc)', () => {
    // The `\b` after the digits prevents `sk-14abc` from matching `sk-14`
    // — `4a` is not a word boundary, so the whole token is rejected.
    expect(extractIssueCodes('sk-14abc')).toEqual([]);
  });

  test('a code embedded in a URL path is still extracted', () => {
    expect(
      extractIssueCodes('https://host/issues/sk-14 and /projects/demo-2'),
    ).toEqual(['sk-14', 'demo-2']);
  });
});
