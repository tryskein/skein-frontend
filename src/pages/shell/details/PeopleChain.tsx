import { useTranslation } from 'react-i18next';
import type { IssueDetail } from '../../../api/issues';
import { Avatar } from '../../../components/Avatar';
import { PersonStatusMark, personLabel } from '../../../components/UserMention';
import type { PersonStatus } from '../../../api/users';

/**
 * sk-37 — delegation-chain row for the issue details panel.
 *
 * Renders the people who've owned this issue end-to-end:
 *
 *     Author admin → Previously bob → Previously carol → Assignee alice
 *
 * sk-285.6.10 — every name carries its ROLE as visible text. The row
 * used to be `reviewer → admin`: the only thing separating author from
 * assignee was the magenta fill on the last chip, and the direction of
 * the arrow, which reads equally well as "handed to" and as "waiting
 * on". Both of those are conventions the reader has to be told; a word
 * is not. The labels also carry the whole meaning for a screen reader,
 * which never saw the fill, and for anyone who cannot separate the two
 * chips by colour — the arrow itself stays `aria-hidden`, so the
 * announced row is "Author admin, Previously bob, Assignee alice".
 *
 * The filled chip on the current assignee stays: colour is a fine
 * ACCELERATOR once the word is there to carry the meaning. (It was
 * magenta until sk-285.7 retired that tone; the fill is now the brand
 * oxblood with its paired `--on-primary` ink.)
 *
 * Dismissed past assignees (those who explicitly opted out via
 * "Drop from Delegated") render with a strikethrough so the reader
 * can see why a name in the chain is no longer engaged.
 *
 * Data shape:
 *   - `createdByUsername`     — original author (always first)
 *   - `previousAssigneeUsernames` — every past assignee, order of
 *                                   reassignment (oldest first); does
 *                                   NOT include the current assignee
 *   - `assignee`              — current assignee (last in the chain)
 *   - `dismissedByUsernames`  — users who Drop-from-Delegated'd;
 *                               renders past assignees in this set
 *                               with strikethrough
 *
 * Edge cases:
 *   - self-assigned at create (creator === assignee) → collapses to a
 *     single "Author & assignee admin" chip
 *   - unassigned → "admin → unassigned"
 *   - empty username slots (deleted users) skipped silently
 *
 * sk-674.18 T055 (screens 1.10, INV-18) — the author and the current
 * assignee carry their state in the issue's space (`createdByStatus`,
 * `assigneeStatus`): a deleted account reads as its pseudonym without an
 * avatar, a departed person greyed with "left" — as a word. Past
 * assignees come as bare names and stay as they are.
 */
export interface PeopleChainProps {
  issue: IssueDetail;
}

export function PeopleChain({ issue }: PeopleChainProps) {
  const { t } = useTranslation('details');
  const creator = issue.createdByUsername ?? null;
  const past = (issue.previousAssigneeUsernames ?? []).filter(
    (u) => u && u.length > 0,
  );
  const dismissed = new Set(
    (issue.dismissedByUsernames ?? []).filter((u) => u && u.length > 0),
  );
  const current = issue.assignee ?? null;
  const creatorLabel = creator ? personLabel(creator, issue.createdByStatus) : null;

  // Self-assigned at create with no reassignments → collapse to one
  // chip ("admin"). The chain has nothing to add.
  if (
    creator &&
    current &&
    creator.toLowerCase() === current.toLowerCase() &&
    past.length === 0
  ) {
    return (
      // `role="group"` so the aria-label is actually honoured — an
      // aria-label on a bare <div> with no role is dropped by most
      // screen readers.
      <div className="people-chain" role="group" aria-label={t('people.aria')}>
        <span className="people-chain-role">{t('people.roleBoth')}</span>
        {/* sk-285.7 fidelity D5 — the chip `Sk Details.dc.html` draws for
            this exact case: «author & assignee» followed by ONE chip made
            of a round 18px initial disc and the name. The chip was a bare
            name on a plate; the disc is the half that was missing, and it
            is the shared <Avatar> rather than a new circle so the colour
            stays the per-user one §8 preserves by name ("per-user color
            (the current Avatar.tsx PALETTE is kept)") — the artboard's
            single `--primary` disc is one instance of that palette, not a
            rule replacing it.

            `aria-hidden` is the component's own: the disc repeats the
            name written beside it, so a reader hears the name once. */}
        <span
          className={['people-chain-current', goneClass(creatorLabel)].filter(Boolean).join(' ')}
          title={t('people.bothTitle', { username: creatorLabel?.text ?? creator })}
        >
          {creatorLabel?.deleted ? null : (
            <Avatar
              username={creator}
              userId={issue.createdBy}
              size="sm"
              title={null}
            />
          )}
          {creatorLabel?.text ?? creator}
          {creatorLabel ? <PersonStatusMark label={creatorLabel} /> : null}
        </span>
      </div>
    );
  }

  // Build the chain as an array of {username, dismissed?, current?} for
  // a single renderer pass. Order: creator → past[0..n] → current.
  type ChainNode = {
    username: string;
    isCreator: boolean;
    isDismissed: boolean;
    isCurrent: boolean;
    /** sk-674.18 T055 — known only for the author and the current assignee. */
    status?: PersonStatus;
  };
  const nodes: ChainNode[] = [];
  if (creator) {
    nodes.push({
      username: creator,
      isCreator: true,
      isDismissed: false,
      isCurrent: false,
      status: issue.createdByStatus,
    });
  }
  for (const u of past) {
    // Avoid duplicating creator if they appear in past chain (server
    // shouldn't emit this combo but defensive).
    if (creator && u.toLowerCase() === creator.toLowerCase() && nodes[0]?.isCreator) {
      continue;
    }
    nodes.push({
      username: u,
      isCreator: false,
      isDismissed: dismissed.has(u),
      isCurrent: false,
    });
  }
  // Current assignee — last node. Skip if already in chain (defensive).
  const currentNorm = current?.toLowerCase() ?? null;
  const lastIsCurrent =
    nodes.length > 0 &&
    nodes[nodes.length - 1].username.toLowerCase() === currentNorm;
  if (current && !lastIsCurrent) {
    nodes.push({
      username: current,
      isCreator: false,
      isDismissed: false,
      isCurrent: true,
      status: issue.assigneeStatus,
    });
  } else if (!current) {
    // Unassigned → add an italic "unassigned" placeholder so the
    // chain still has a tail to anchor "current".
    nodes.push({
      username: 'unassigned',
      isCreator: false,
      isDismissed: false,
      isCurrent: true,
    });
  } else if (lastIsCurrent) {
    // Mark the existing last node as current (creator-and-current case
    // when creator was the only user). Mutates in place for one render.
    nodes[nodes.length - 1].isCurrent = true;
    nodes[nodes.length - 1].status = issue.assigneeStatus;
  }

  const roleLabel = (n: ChainNode): string => {
    if (n.isCreator) return t('people.roleCreator');
    if (n.isCurrent) return t('people.roleAssignee');
    return t('people.rolePast');
  };

  return (
    <div className="people-chain" role="group" aria-label={t('people.aria')}>
      {nodes.map((n, idx) => {
        const label = personLabel(n.username, n.status);
        return (
        // Index belongs in this key. The chain is an ordered reassignment
        // HISTORY, not a reorderable list: the same person can appear more
        // than once (alice → bob → alice), and those repeats carry identical
        // username and identical creator/current/dismissed flags. A key built
        // from the fields alone collides on that shape, so React reconciles
        // the wrong node and warns about duplicate keys. Entries are only
        // appended, so the index is stable for every node already rendered.
        <span
          key={`${n.username}-${idx}`}
          className="people-chain-step"
        >
          {idx > 0 ? (
            <span className="people-chain-arrow" aria-hidden="true">
              →
            </span>
          ) : null}
          {/* sk-285.6.10 — the role, as a word, before the name. This
              is the only thing on the row that survives greyscale and
              a screen reader both. */}
          <span className="people-chain-role">{roleLabel(n)}</span>
          <span
            className={[
              'people-chain-user',
              n.isCreator ? 'creator' : '',
              n.isCurrent ? 'current' : '',
              n.isDismissed ? 'dismissed' : '',
              n.username === 'unassigned' ? 'unassigned' : '',
              goneClass(label),
            ]
              .filter(Boolean)
              .join(' ')}
            title={
              n.isCurrent
                ? t('people.current', { username: label.text })
                : n.isCreator
                  ? t('people.creator', { username: label.text })
                  : n.isDismissed
                    ? t('people.pastDismissed', { username: label.text })
                    : t('people.past', { username: label.text })
            }
          >
            {n.username === 'unassigned' ? t('people.unassigned') : label.text}
            <PersonStatusMark label={label} />
          </span>
        </span>
        );
      })}
    </div>
  );
}

/** The greyed look of a person who left the space or whose account was deleted. */
function goneClass(label: { departed: boolean; deleted: boolean } | null): string {
  return label && (label.departed || label.deleted) ? 'person-gone' : '';
}
