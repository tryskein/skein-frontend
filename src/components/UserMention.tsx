import { CSSProperties, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthOptional } from '../auth/AuthContext';
import type { PersonStatus } from '../api/users';
import i18n from '../i18n/config';

/**
 * sk-674.18 T055 (screens 1.10, INV-18) — how a person reads wherever
 * people are shown: author, assignee, comments, watchers, mentions,
 * filters. A deleted account is its permanent pseudonym — never the old
 * name, no profile link; a person who left the space keeps the name, greyed,
 * with the word "left" beside it. The state is a WORD for the eye and
 * the screen reader alike, never a colour alone. A deactivated account is
 * not a departure and reads as before. No status (an api that does not
 * serve it yet) — the name as before.
 */
export interface PersonLabel {
  /** What to print: the pseudonym of a deleted account, else the name. */
  text: string;
  departed: boolean;
  deleted: boolean;
}

export function personLabel(name: string, status: PersonStatus | null | undefined): PersonLabel {
  const deleted = status?.deleted === true;
  const pseudonym = status?.pseudonym?.trim() || '';
  return {
    // sk-674.18 T055 (INV-18) — a deleted account never
    // reads as the name the caller passed (a snapshot of the old username):
    // without its pseudonym it is a neutral "Deleted user". Read
    // through the i18n instance at call time, as `Toaster.tsx` does — the
    // function is called outside components too.
    text: deleted ? (pseudonym !== '' ? pseudonym : i18n.t('common:person.deletedName')) : name,
    departed: !deleted && status?.departed === true,
    deleted,
  };
}

/** The visible word "left" / "account deleted" after a person, or nothing. */
export function PersonStatusMark({ label }: { label: PersonLabel }) {
  const { t } = useTranslation('common');
  if (!label.departed && !label.deleted) return null;
  return (
    <span
      className="person-status-mark"
      title={label.deleted ? t('person.deletedTitle') : t('person.departedTitle')}
    >
      {' · '}
      {label.deleted ? t('person.deleted') : t('person.departed')}
    </span>
  );
}

/**
 * UserMention renders `@username` chips inside body text and comments.
 *
 * Visual recipe (sk-38 polish):
 *   - When the mention's username matches the CALLER (i.e. it's a
 *     `@me`-style reference), render a filled cyan pill so the user
 *     can spot at a glance WHERE they were tagged inside a long body
 *     or comment thread. Bold, cream-on-cyan, slight padding +
 *     border-radius.
 *   - All other mentions render in the brand text tone — visible as a
 *     mention pattern, but quieter so they don't compete with the
 *     self-mention pill for attention.
 *
 * sk-521 — the three tones used to be read off the `--skein-*` bridge,
 * which resolves to the ember CRT palette on `:root` and to the role
 * dictionary under `.col-details`. Every surface that renders a mention
 * today is inside that column, so nothing on screen moved; what moved is
 * that the tone no longer depends on WHERE the chip is drawn. Carrying
 * this component out of the details column used to repaint it ember,
 * silently.
 *
 * When a `userId` is supplied the chip becomes a link to
 * `/users/{username}` (profile page is future work). Without a userId
 * we render plain styled text — used when the server couldn't resolve
 * the handle to a real user (legacy data, free-form assignee strings).
 *
 * `kind` lets agent / system actors render in their own colour without
 * leaking that detail through prop drilling — it's the same colour
 * convention CommentsThread already uses.
 */
export interface UserMentionProps {
  username: string;
  /** When set, mention becomes a link to /users/{username}. */
  userId?: string | null;
  /**
   * Visual treatment for non-human actors. Default 'human' — `--primary`.
   *   'agent' → `--primary-h` (matches CommentsThread author colours)
   *   'system' → `--ink-3` (greyed)
   */
  kind?: 'human' | 'agent' | 'system';
  /**
   * Highlighting of one's OWN mention with a coloured plate. On by default —
   * the component was created for it: it makes an `@` reference to oneself
   * stand out inside a long text.
   *
   * sk-514 (4) — turned off where the name is not a mention. For the
   * comment author's LABEL the plate is not needed: the author is shown on every
   * row, and highlighting oneself is reporting what is already known. Worse
   * still, a caller that overrode only the COLOUR got dark
   * ink on the brand plate: measured 2.40 in the light theme and 1.74 in
   * the dark one against a threshold of 4.5, i.e. the label became unreadable exactly
   * on one's own comments.
   *
   * A switch, not "do not override the colour": the reason is not the colour but
   * that the label is not a mention.
   */
  selfHighlight?: boolean;
  /**
   * sk-674.18 T055 — the person's state in this context: a deleted account
   * prints its pseudonym as plain text (no link), a departed one is greyed
   * with "left".
   */
  status?: PersonStatus | null;
  className?: string;
  style?: CSSProperties;
}

function colourFor(kind: UserMentionProps['kind']): string {
  switch (kind) {
    case 'agent':
      return 'var(--primary-h)';
    case 'system':
      return 'var(--ink-3)';
    case 'human':
    default:
      return 'var(--primary)';
  }
}

export function UserMention({
  username,
  userId,
  kind = 'human',
  selfHighlight = true,
  status,
  className,
  style,
}: UserMentionProps) {
  const navigate = useNavigate();
  // Use the optional variant so this component renders in unit tests
  // without requiring a full AuthProvider wrapper. Production callers
  // always mount inside the Shell, which provides AuthProvider.
  const auth = useAuthOptional();
  const colour = colourFor(kind);

  // Self-mention detection — caller is logged-in and the mention's
  // username matches their own. Powers the cyan-pill highlight that
  // makes the user's own @-tags pop inside long body text.
  const isSelfMention =
    selfHighlight
    && !!auth?.user
    && auth.user.username.toLowerCase() === username.toLowerCase();

  const baseStyle: CSSProperties = isSelfMention
    ? {
        fontFamily: 'var(--font-mono)',
        background: 'var(--secondary)',
        color: 'var(--bg)',
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        ...style,
      }
    : {
        fontFamily: 'var(--font-mono)',
        color: colour,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      };

  const label = personLabel(username, status);
  if (label.deleted || label.departed) {
    // Neither a self-highlight nor a profile link: a deleted account has
    // no profile, and a departed person is shown greyed as a past presence.
    // Review HTML-W1 — the caller's colour and plate (a comment author's
    // `AUTHOR_STYLE` is --ink) are not taken: the gone look is the class's.
    const { color: _color, background: _background, ...restStyle } = style ?? {};
    return (
      <span
        className={['person-gone', className].filter(Boolean).join(' ')}
        style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', ...restStyle }}
      >
        @{label.text}
        <PersonStatusMark label={label} />
      </span>
    );
  }

  // Plain text — no userId means we can't resolve a profile route.
  if (!userId) {
    return (
      <span className={className} style={baseStyle}>
        @{username}
      </span>
    );
  }

  // Linked mention. We render as <a href> so middle-click / cmd-click /
  // copy-link all behave like native links; intercept plain left-click
  // for SPA routing. The `skein-mention` class supplies the underline
  // affordance + visible focus ring (WCAG 1.4.1 / 2.4.7) — inline
  // styling can't express :focus-visible, hence the CSS hand-off.
  const href = `/users/${encodeURIComponent(username)}`;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    navigate(href);
  };

  return (
    <a
      href={href}
      onClick={onClick}
      className={['skein-mention', className].filter(Boolean).join(' ')}
      style={baseStyle}
    >
      @{username}
    </a>
  );
}
