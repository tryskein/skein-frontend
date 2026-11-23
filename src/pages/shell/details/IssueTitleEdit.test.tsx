/**
 * The issue title field from the keyboard (the `onKeyDown` of
 * `IssueTitleEdit`): Enter saves the title — trimmed, and never an empty one —
 * and leaves the field; Shift+Enter is a line break inside the title and saves
 * nothing yet.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  test('Enter saves the trimmed title and leaves the field', async () => {
    const user = userEvent.setup();
    const { onSave, field } = renderTitle();

    await user.clear(field);
    await user.type(field, '  Refund the order total  ');
    expect(document.activeElement).toBe(field);
    await user.keyboard('{Enter}');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Refund the order total');
    expect(document.activeElement).not.toBe(field);
    expect(field.value).not.toContain('\n');
  });

  test('Shift+Enter breaks the line and saves nothing yet', async () => {
    const user = userEvent.setup();
    const { onSave, field } = renderTitle('First line');

    await user.click(field);
    await user.keyboard('{Shift>}{Enter}{/Shift}second');

    expect(field.value).toBe('First line\nsecond');
    expect(document.activeElement).toBe(field);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('a title of spaces only is not saved', async () => {
    const user = userEvent.setup();
    const { onSave, field } = renderTitle();

    await user.clear(field);
    await user.type(field, '   ');
    await user.keyboard('{Enter}');

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
