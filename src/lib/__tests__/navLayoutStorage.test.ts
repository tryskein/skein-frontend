/**
 * sk-551.8 F7 — this machine's storage of the sections layout.
 *
 * Reference: spec "Data / entities" (browser storage), the edge case
 * "storage unavailable / corrupted / values out of bounds", SC-004 and
 * INV-4 (desktop and tablet widths apart; split and section folding
 * shared), US-5 (200…480, default 300), US-4 (split default 0.5), and the
 * sections hint's own flag ("Auto-fold hint").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readNavColumnCollapsed,
  readNavHintSeen,
  readNavSections,
  readNavWidth,
  readNavWorkspace,
  writeNavColumnCollapsed,
  writeNavHintSeen,
  writeNavSections,
  writeNavWidth,
  writeNavWorkspace,
} from '../navLayoutStorage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('damaged storage reads as the defaults (300, 0.5, expanded)', () => {
  it.each([
    ['skein.layout.nav.width', '{not json'],
    ['skein.layout.nav.width', 'wide'],
    ['skein.layout.nav.width', ''],
    ['skein.layout.nav.width-tablet', 'null'],
  ])('width key %s = %j → 300', (key, raw) => {
    window.localStorage.setItem(key, raw);
    const mode = key.endsWith('tablet') ? 'tablet' : 'desktop';
    expect(readNavWidth(mode)).toBe(300);
  });

  it.each([['{not json'], ['[1,2]'], ['"text"'], ['{"split":"half","collapsed":7}']])(
    'sections record %j → split 0.5, both sections expanded',
    (raw) => {
      window.localStorage.setItem('skein.layout.nav.sections', raw);
      expect(readNavSections()).toEqual({
        split: 0.5,
        collapsed: { projects: false, queues: false },
      });
    },
  );

  it.each([['{not json'], ['yes'], ['1']])('column record %j → expanded', (raw) => {
    window.localStorage.setItem('skein.layout.nav.collapsed', raw);
    expect(readNavColumnCollapsed()).toBe(false);
  });

  it('auto-fold record that is not JSON → no mark, no opt-out', () => {
    window.localStorage.setItem('skein.layout.nav.workspace', '{not json');
    expect(readNavWorkspace()).toEqual({ auto: false, optOut: false });
  });

  it('nothing stored → 300 on both widths, 0.5, expanded', () => {
    expect(readNavWidth('desktop')).toBe(300);
    expect(readNavWidth('tablet')).toBe(300);
    expect(readNavSections()).toEqual({ split: 0.5, collapsed: { projects: false, queues: false } });
    expect(readNavColumnCollapsed()).toBe(false);
  });
});

describe('values out of bounds are clamped into them', () => {
  it.each([
    ['desktop', '50', 200],
    ['desktop', '9000', 480],
    ['tablet', '-3', 200],
    ['tablet', '481', 480],
  ] as const)('stored %s width %s → %d', (mode, raw, expected) => {
    window.localStorage.setItem(
      mode === 'tablet' ? 'skein.layout.nav.width-tablet' : 'skein.layout.nav.width',
      raw,
    );
    expect(readNavWidth(mode)).toBe(expected);
  });

  it.each([
    [1.7, 1],
    [-0.4, 0],
  ])('stored split %d → %d', (split, expected) => {
    window.localStorage.setItem(
      'skein.layout.nav.sections',
      JSON.stringify({ split, collapsed: { projects: false, queues: true } }),
    );
    expect(readNavSections().split).toBe(expected);
  });

  it.each([
    [10, 200],
    [1000, 480],
  ])('a written width of %d reads back as %d', (px, expected) => {
    writeNavWidth('desktop', px);
    expect(readNavWidth('desktop')).toBe(expected);
  });
});

describe('a throwing storage breaks neither reading nor writing', () => {
  it('every reader answers the defaults and every writer returns', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(readNavWidth('desktop')).toBe(300);
    expect(readNavWidth('tablet')).toBe(300);
    expect(readNavSections()).toEqual({ split: 0.5, collapsed: { projects: false, queues: false } });
    expect(readNavColumnCollapsed()).toBe(false);
    expect(readNavWorkspace()).toEqual({ auto: false, optOut: false });
    // unreadable storage answers «not shown» (the module's documented choice)
    expect(readNavHintSeen()).toBe(false);

    expect(() => writeNavWidth('desktop', 400)).not.toThrow();
    expect(() => writeNavWidth('tablet', 250)).not.toThrow();
    expect(() =>
      writeNavSections({ split: 0.3, collapsed: { projects: true, queues: false } }),
    ).not.toThrow();
    expect(() => writeNavColumnCollapsed(true)).not.toThrow();
    expect(() => writeNavWorkspace({ auto: true, optOut: true })).not.toThrow();
    expect(() => writeNavHintSeen()).not.toThrow();
  });
});

describe('INV-4 — widths per width mode, split and folding shared', () => {
  it('desktop 400 and tablet 250 each read back their own value', () => {
    writeNavWidth('desktop', 400);
    writeNavWidth('tablet', 250);
    expect(readNavWidth('desktop')).toBe(400);
    expect(readNavWidth('tablet')).toBe(250);
  });

  it('split and section folding persist as one record, the same for both widths', () => {
    writeNavWidth('desktop', 400);
    writeNavWidth('tablet', 250);
    writeNavSections({ split: 0.3, collapsed: { projects: true, queues: false } });
    // There is no width-mode parameter on the record: one read answers both.
    expect(readNavSections()).toEqual({ split: 0.3, collapsed: { projects: true, queues: false } });
    writeNavColumnCollapsed(true);
    expect(readNavColumnCollapsed()).toBe(true);
  });
});

describe('the sections hint flag is its own', () => {
  it('a side-by-side hint already shown does not make the sections hint shown', () => {
    window.localStorage.setItem('skein.layout.board-workspace-hint-seen', 'true');
    expect(readNavHintSeen()).toBe(false);
  });

  it('marking the sections hint shown writes its own key and leaves the side-by-side one alone', () => {
    writeNavHintSeen();
    expect(readNavHintSeen()).toBe(true);
    expect(window.localStorage.getItem('skein.layout.nav.hint-seen')).toBe('true');
    expect(window.localStorage.getItem('skein.layout.board-workspace-hint-seen')).toBeNull();
  });
});

describe('SC-004 — every record survives a reload on this machine', () => {
  it.each([
    [{ auto: true, optOut: false }],
    [{ auto: false, optOut: true }],
  ])('the auto-fold record %o reads back as written', (record) => {
    writeNavWorkspace(record);
    expect(readNavWorkspace()).toEqual(record);
  });

  it('section folding reads back per section', () => {
    writeNavSections({ split: 0.5, collapsed: { projects: false, queues: true } });
    expect(readNavSections().collapsed).toEqual({ projects: false, queues: true });
  });

  it('the column unfolded again reads back as expanded', () => {
    writeNavColumnCollapsed(true);
    writeNavColumnCollapsed(false);
    expect(readNavColumnCollapsed()).toBe(false);
  });

  it.each([['null'], ['[true]'], ['"x"']])('auto-fold record %j that is not an object → no mark, no opt-out', (raw) => {
    window.localStorage.setItem('skein.layout.nav.workspace', raw);
    expect(readNavWorkspace()).toEqual({ auto: false, optOut: false });
  });

  it('a split stored as a string is not a split', () => {
    window.localStorage.setItem('skein.layout.nav.sections', JSON.stringify({ split: '0.2', collapsed: {} }));
    expect(readNavSections().split).toBe(0.5);
  });
});

describe('readers hand out fresh records', () => {
  it('mutating a returned default does not change the next read', () => {
    const sections = readNavSections();
    sections.split = 0.9;
    sections.collapsed.queues = true;
    const workspace = readNavWorkspace();
    workspace.optOut = true;
    expect(readNavSections()).toEqual({ split: 0.5, collapsed: { projects: false, queues: false } });
    expect(readNavWorkspace()).toEqual({ auto: false, optOut: false });
  });
});
