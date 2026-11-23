/**
 * The issue title field from the keyboard (the `onKeyDown` of
 * `IssueTitleEdit`): Enter saves the title — trimmed, and never an empty one —
 * and leaves the field; Shift+Enter is a line break inside the title and saves
 * nothing yet.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n/config';
import { IssueTitleEdit } from './IssueTitleEdit';

afterEach(cleanup);

function renderTitle(initial = 'Old title') {
  const onSave = vi.fn(async (_next: string) => undefined);
  render(<IssueTitleEdit initial={initial} onSave={onSave} />);
  const field = screen.getByRole('textbox', { name: i18n.t('details:title.aria') }) as HTMLTextAreaElement;
  return { onSave, field };
}

describe('IssueTitleEdit — keyboard', () => {
  // The field also saves on its own 2 s after the last change
  // (`useInlineEdit.ts#DEFAULT_DEBOUNCE_MS`). The clock is the test's, so
  // that timer cannot fire between typing and the key under test, and the
  // only save seen is the one the key made. Events are fired directly:
  // user-event's own pauses run on the same (now stopped) clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The text is typed and the field still has it, unsaved, just short of the autosave. */
  function typed(field: HTMLTextAreaElement, text: string) {
    field.focus();
    fireEvent.change(field, { target: { value: text } });
    act(() => vi.advanceTimersByTime(1999));
  }

  test('Enter saves the trimmed title and leaves the field', () => {
    const { onSave, field } = renderTitle();
    typed(field, '  Refund the order total  ');
    expect(onSave).not.toHaveBeenCalled();

    const notTaken = fireEvent.keyDown(field, { key: 'Enter' });

    expect(notTaken).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Refund the order total');
    expect(document.activeElement).not.toBe(field);
  });

  test('Shift+Enter is left to the field as a line break and saves nothing', () => {
    const { onSave, field } = renderTitle('First line');
    field.focus();

    const notTaken = fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });

    expect(notTaken).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('a title of spaces only is not saved', () => {
    const { onSave, field } = renderTitle();
    typed(field, '   ');

    fireEvent.keyDown(field, { key: 'Enter' });

    expect(document.activeElement).not.toBe(field);
    expect(onSave).not.toHaveBeenCalled();
  });
});

/**
 * The Russian text of a key, read from the Russian dictionary rather than
 * written out here (the wording is not a contract, §5), and required to
 * differ from the English one: a key missing from `ru.ts` resolves to the
 * English fallback and fails this.
 */
function ruOnly(ns: string, key: string, opts: Record<string, unknown> = {}): string {
  const ruText = i18n.getFixedT('ru', ns)(key, opts) as string;
  expect(ruText, `${ns}:${key}`).not.toBe(i18n.getFixedT('en', ns)(key, opts) as string);
  return ruText;
}

/**
 * sk-1048.77 — in Russian the title field answers to its Russian accessible
 * name; the placeholder is not the name.
 */
describe('IssueTitleEdit — Russian accessible name', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('the field answers to its Russian name and holds the title', async () => {
    await i18n.changeLanguage('ru');
    render(<IssueTitleEdit initial="Возврат средств" onSave={vi.fn(async () => undefined)} />);

    expect((screen.getByRole('textbox', { name: ruOnly('details', 'title.aria') }) as HTMLTextAreaElement).value).toBe('Возврат средств');
  });
});
