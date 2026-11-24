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
import { ruOnly } from '../../../test/ruText';

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

  test('other keys are typing, not saving: the field keeps focus and nothing is saved', () => {
    const { onSave, field } = renderTitle();
    typed(field, 'Refund the order total');

    for (const key of ['a', ' ', 'Backspace']) {
      expect(fireEvent.keyDown(field, { key }), key).toBe(true);
      expect(document.activeElement, key).toBe(field);
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  // Tab is not typing: the browser moves focus on, and leaving the field
  // saves what was typed (the field's `onBlur`). `fireEvent.keyDown` does
  // not move focus, so the move itself is the blur.
  test('leaving the field (Tab to the next control) saves the trimmed title', () => {
    const { onSave, field } = renderTitle();
    typed(field, '  Refund the order total  ');

    fireEvent.blur(field);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Refund the order total');
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
