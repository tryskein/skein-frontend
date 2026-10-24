/**
 * sk-489 T018 — the close outcome REACHES the feed row on the screen
 * (US-3, SC-011, the seam of row 64).
 *
 * A guard of the SEAM, not of the shape: the shape of the row parts is proven by the helper suite
 * (`lib/formatEventLine.test.ts`), here — that the parts reach the
 * document. The file was created by this task: the feed row renderer
 * had no suite of its own, and the SC-011 statement "the feed row names
 * the outcome" rested on reading the code. The lesson paid for in wave F/1 — the pure
 * helper is green, while the only production wiring loses the value —
 * is exactly about this case.
 *
 * The row tail is one for everybody, and its new owner (the outcome) took the slot
 * that was already taken by the former one ("(stale)" on a claim release by the system).
 * So the seam has two sides, and both are here: the new one is printed, the former one is not
 * pushed out.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../i18n/config';
import type { NotificationItem } from '../api/notifications';
import { EventLineRender } from './EventLineRender';

function ev(partial: Partial<NotificationItem>): NotificationItem {
  return {
    id: 1,
    type: 'issue.status_changed',
    createdAt: '2026-09-19T10:00:00Z',
    readAt: null,
    archivedAt: null,
    actor: { username: 'alice', userId: 'u-1', type: 'human' },
    entity: {
      type: 'issue',
      id: 'sk-42',
      title: 'Example',
      projectId: 'p-1',
      projectIdPrefix: 'sk',
    },
    summary: 'alice changed status of sk-42 (Example)',
    field: null,
    oldValue: 'open',
    newValue: 'closed',
    ...partial,
  };
}

describe('EventLineRender — the close outcome on the screen (sk-489 T018)', () => {
  test('a close with "will not do": the outcome is printed next to the transition', () => {
    const { container } = render(<EventLineRender ev={ev({ closeOutcome: 'wont_do' })} />);
    expect(container.textContent).toContain('changed status');
    expect(container.textContent).toContain('closed');
    expect(container.querySelector('.outbox-ev-tail')?.textContent).toBe('(wont_do)');
  });

  test('a close "done": the row on the screen as today', () => {
    const { container } = render(<EventLineRender ev={ev({ closeOutcome: 'done' })} />);
    expect(container.querySelector('.outbox-ev-tail')).toBeNull();
    expect(container.textContent).not.toContain('done');
  });

  test('an outcome change: both sides of the transition on the screen', () => {
    const { container } = render(
      <EventLineRender
        ev={ev({
          type: 'issue.outcome_changed',
          field: 'closeOutcome',
          oldValue: 'done',
          newValue: 'wont_do',
        })}
      />,
    );
    expect(container.textContent).toContain('changed outcome');
    expect(container.querySelector('.outbox-ev-old')?.textContent).toBe('done');
    expect(container.querySelector('.outbox-ev-new')?.textContent).toBe('wont_do');
    // The row has no field label: a change of the issue state, not an edit
    // of a column (see the branch docblock in `lib/formatEventLine.ts`).
    expect(container.querySelector('.outbox-ev-field')).toBeNull();
  });

  test('the former tail owner is not pushed out: "(stale)" is still printed', () => {
    const { container } = render(
      <EventLineRender
        ev={ev({
          type: 'issue.unclaimed',
          actor: { username: 'system', userId: null, type: 'system' },
        })}
      />,
    );
    expect(container.querySelector('.outbox-ev-tail')?.textContent).toBe('(stale)');
  });
});

describe('EventLineRender — interface language (sk-551.24)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('under RU a status change reads in Russian', async () => {
    await i18n.changeLanguage('ru');
    const { container } = render(<EventLineRender ev={ev({})} />);
    expect(container.querySelector('.outbox-ev-verb')?.textContent).toBe('сменил статус');
  });
});

/**
 * sk-551.27 — in a narrow column the login and values are cut with an ellipsis, not
 * broken in the middle of a word; on hover and focus the truncation is lifted (CSS,
 * jsdom does not see it — §7). What is checked here is what is visible without layout:
 * only the picture is cut, while the full row text is the accessible name of the row
 * button (grok html review: the native `title` was not a path to the full text
 * either from the keyboard or on touch).
 */
describe('EventLineRender — full text in the accessible name (sk-551.27)', () => {
  test('the login, the field and both sides of the transition in full in the row button name', () => {
    const { getByRole } = render(
      <button type="button">
        <EventLineRender
          ev={ev({
            type: 'issue.updated',
            actor: { username: 'konstantin_vasilevsky', userId: 'u-2', type: 'human' },
            field: 'acceptance_criteria',
            oldValue: 'in_progress_and_more',
            newValue: 'closed_for_good',
          })}
        />
      </button>,
    );
    expect(getByRole('button').textContent).toBe(
      'konstantin_vasilevsky changed acceptance_criteria (in_progress_and_more → closed_for_good)',
    );
    // The arrow is `aria-hidden`; spacing inside the brackets is the name
    // algorithm's business (it pads the inline-block atoms), so it is
    // compared with whitespace normalised.
    expect(
      getByRole('button', {
        name: (name) =>
          name.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')') ===
          'konstantin_vasilevsky changed acceptance_criteria (in_progress_and_more closed_for_good)',
      }),
    ).toBeTruthy();
  });
});
