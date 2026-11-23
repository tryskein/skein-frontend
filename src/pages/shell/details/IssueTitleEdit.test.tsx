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
