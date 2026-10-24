import { type ReactNode, useRef, useState } from 'react';
import { IconArrowDownLeft, IconArrowUpRight, IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  type DepType,
  type DependencyEdge,
  type DependencyList,
  addDependency,
  removeDependency,
} from '../../../../api/dependencies';
import { DependencyRow } from '../../../../components/DependencyRow';
import { DEP_TYPE_GLYPHS, DEP_TYPE_TOOLTIPS } from '../../../../lib/depTypeIcons';
import { issueDependenciesKey, issueDetailKey } from '../../../../lib/useIssueDetail';
import { useToaster } from '../../../../components/Toaster';
import { Section } from '../Section';
import { extractMessage } from '../../../../lib/extractApiMessage';
import { refusalReason } from '../../../../lib/saveFailureReason';

// sk-35: parent-child is the canonical hierarchy edge again. Adding
// it here re-parents the issue; deleting it makes the issue top-level.
// The new Move button on DetailsHeader wraps the same calls in a
// task-shaped UI; this dropdown stays for the advanced/MCP-equivalent
// path.
const DEP_TYPES: DepType[] = [
  'blocks',
  'related',
  'discovered-from',
  'supersedes',
  'duplicates',
  'waits-for',
  'parent-child',
];

export interface DependenciesSectionProps {
  projectId: string;
  issueId: string;
  dependencies: DependencyList | undefined;
  /**
   * sk-421.2 T023 (F-18) — the section must know that the card is an epic:
   * before this task it received only the project, the task and the list of links, and
   * an epic cannot be told apart by the edges themselves (a hierarchy edge looks
   * the same from both sides).
   */
  isEpic: boolean;
}

/**
 * Dependencies section — artboard 4c.
 *
 * Two direction GROUPS (this issue depends on … / … depends on this),
 * each opened by a heading that carries an arrow, a name and a count,
 * plus an inline add form. Removal works on outgoing edges only —
 * incoming ones are owned by the other side. The cache key matches
 * `issueDependenciesKey(projectId, issueId)` so live-event invalidation
 * routes through the same predicate.
 *
 * ─── What the groups replaced, and why ─────────────────────────────
 *
 * The section used to print two lowercase prose labels — «this depends
 * on (outgoing):» / «depends on this (incoming):» — and then repeat the
 * direction inside every row as an arrow glyph. Direction was stated
 * twice and one of those statements scaled with the number of edges.
 * The heading now states it once, in the shape the eye reads first (an
 * arrow icon), and the rows are free of it; a direction with nothing in
 * it says «none» ON the heading rather than as a line under it, so an
 * empty half of the graph costs one row instead of two.
 *
 * ─── sk-285.6.2 — an empty section is one row ──────────────────────
 *
 * With no edges either way this was the worst offender in the card: two
 * direction labels, two "— none" lines, a "Dependencies 0" chip and an
 * add button, all for nothing. It collapses to one row carrying the add
 * affordance; opening the form expands the section (the form IS
 * content), and it re-collapses when the form is dismissed on a
 * still-empty issue.
 */
export function DependenciesSection({
  projectId,
  issueId,
  dependencies,
  isEpic,
}: DependenciesSectionProps) {
  const { t } = useTranslation('details');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToaster();

  const [addOpen, setAddOpen] = useState(false);
  // sk-285.6.2 — with the section collapsed this button is the ONLY way
  // in, and pressing it unmounts the button itself. Focus has to be
  // handed to the form it reveals or it falls to <body> and a keyboard
  // user tabs the whole card again to reach what they just opened
  // (WCAG 2.4.3). Same move as EditableTextSection.enterEdit.
  const addIdRef = useRef<HTMLInputElement>(null);
  const openAdd = () => {
    setAddOpen(true);
    requestAnimationFrame(() => addIdRef.current?.focus());
  };
  const [draftToId, setDraftToId] = useState('');
  const [draftType, setDraftType] = useState<DepType>('blocks');

  // sk-421.2 T023 (US-4, R-9) — on an epic the INCOMING hierarchy edges
  // duplicate the child tasks section: the same tasks a second time, without
  // progress and without order. The filter is ON DISPLAY and only here:
  // the dependencies query is shared and cached, and its other consumers
  // must see the full list — filtering on the server would mean
  // changing the contract of a shared query for the sake of one surface.
  //
  // Direction matters: only the incoming half is cut. An OUTGOING
  // hierarchy edge is the epic's link to its OWN parent,
  // it is not shown in the children section and would be lost completely.
  const visibleIncoming = (dependencies?.incoming ?? []).filter(
    (e) => !(isEpic && e.type === 'parent-child'),
  );

  // The section counter counts what is SHOWN, not what arrived:
  // otherwise "Dependencies 4" would stand over two rows (SC-006).
  const total = (dependencies?.outgoing.length ?? 0) + visibleIncoming.length;

  const removeMut = useMutation<
    void,
    Error,
    { toId: string; type: DepType },
    { previous: DependencyList | undefined }
  >({
    mutationFn: ({ toId, type }) => removeDependency(projectId, issueId, toId, type),
    onMutate: async ({ toId, type }) => {
      const key = issueDependenciesKey(projectId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DependencyList>(key);
      if (previous) {
        qc.setQueryData<DependencyList>(key, {
          ...previous,
          outgoing: previous.outgoing.filter(
            (e) => !(e.toId === toId && e.type === type),
          ),
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      const key = issueDependenciesKey(projectId, issueId);
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(refusalReason(err, t) ?? extractMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: issueDependenciesKey(projectId, issueId),
      });
      // sk-35: parent-child edges affect parentIdCurrent (server-derived
      // from the dep graph). Always refresh the detail + lists; cheap and
      // simpler than gating on the edge type.
      void qc.invalidateQueries({ queryKey: issueDetailKey(issueId) });
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'issues' || q.queryKey[0] === 'deps'),
      });
    },
  });

  const addMut = useMutation<
    void,
    Error,
    { toId: string; type: DepType }
  >({
    mutationFn: async ({ toId, type }) => {
      await addDependency(projectId, issueId, { toId, type });
    },
    onSuccess: () => {
      setAddOpen(false);
      setDraftToId('');
      setDraftType('blocks');
      void qc.invalidateQueries({
        queryKey: issueDependenciesKey(projectId, issueId),
      });
      // sk-35: parent-child edges affect parentIdCurrent (server-derived
      // from the dep graph). Always refresh the detail + lists; cheap and
      // simpler than gating on the edge type.
      void qc.invalidateQueries({ queryKey: issueDetailKey(issueId) });
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'issues' || q.queryKey[0] === 'deps'),
      });
    },
    onError: (err) => toast.error(refusalReason(err, t) ?? extractMessage(err)),
  });

  const goToIssue = (otherId: string, otherProjectId: string) => {
    // Cross-project navigation. Route uses project UUID — backend
    // resolves identically across all aliases. New shell URL shape.
    navigate(`/projects/${otherProjectId}/issues/${otherId}`);
  };

  const removeRow = (edge: DependencyEdge) => {
    removeMut.mutate({ toId: edge.toId, type: edge.type });
  };

  const closeAdd = () => {
    setAddOpen(false);
    setDraftToId('');
  };

  const submitAdd = () => {
    const trimmed = draftToId.trim();
    if (!trimmed) {
      toast.error(t('deps.idRequired'));
      return;
    }
    addMut.mutate({ toId: trimmed, type: draftType });
  };

  const addAffordance = (
    <button
      type="button"
      className="empty-section-add"
      aria-label={t('deps.addAffordance')}
      onClick={openAdd}
    >
      {/* sk-285.7.2.55 — see `EditableTextSection`: one-word visible
          label beside `ti-plus`, the full phrase as the accessible
          name. */}
      <IconPlus size={16} stroke={1.75} aria-hidden />
      {t('emptyAdd.add')}
    </button>
  );

  return (
    <Section
      title={t('sectionsMore.dependencies')}
      count={total}
      // The add FORM is content: while it is open the section stays
      // expanded even with zero edges, or the form would have nowhere
      // to live.
      empty={total === 0 && !addOpen && !!dependencies}
      emptyAction={addAffordance}
    >
      {!dependencies ? (
        // One plaque, not one per direction: nothing is known about
        // EITHER half while the request is in flight, and saying so
        // twice reads as two separate waits.
        <div className="detail-status-plaque" role="status" aria-live="polite">
          <span className="detail-spinner" aria-hidden />
          {t('deps.loading')}
        </div>
      ) : (
        <>
          <DirectionGroup
            icon={<IconArrowUpRight size={16} stroke={1.75} aria-hidden />}
            label={t('deps.groupOutgoing')}
            emptyWord={t('emptyValue')}
            edges={dependencies.outgoing}
            onClickIssue={goToIssue}
            onRemove={removeRow}
            removing={removeMut.isPending ? removeMut.variables : undefined}
          />
          <DirectionGroup
            icon={<IconArrowDownLeft size={16} stroke={1.75} aria-hidden />}
            label={t('deps.groupIncoming')}
            emptyWord={t('emptyValue')}
            edges={visibleIncoming}
            onClickIssue={goToIssue}
          />
        </>
      )}

      {addOpen ? (
        <form
          className="detail-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitAdd();
          }}
          onKeyDown={(e) => {
            // Esc closes from anywhere inside the form — including the
            // type select, where the browser's own Esc only dismisses
            // the dropdown.
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeAdd();
            }
          }}
        >
          <div className="detail-form-grid">
            <label className="detail-form-label">
              {t('deps.typeLabel')}
              {/* No `aria-label` here, deliberately. The field has a
                  VISIBLE label now — artboard 4c draws both fields
                  labelled — and an aria-label would REPLACE it in the
                  accessible name: a speech-input user saying «link type»
                  would find nothing, because the control would answer to
                  «dependency type» instead (WCAG 2.5.3, Label in Name).
                  The `<label>` wrapping this select is the name. */}
              <select
                className="detail-form-select"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as DepType)}
              >
                {DEP_TYPES.map((type) => {
                  const glyph = DEP_TYPE_GLYPHS[type];
                  // The same glyph the row's chip carries, so the option
                  // list and the list above it name the type the same
                  // way. An `<option>` cannot hold markup, so the glyph
                  // is part of the string here rather than an element.
                  return (
                    <option key={type} value={type}>
                      {glyph ? `${glyph} ${type}` : type}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="detail-form-label">
              {t('deps.idLabel')}
              {/* This one DOES keep an aria-label, and the asymmetry is
                  the rule rather than an exception to it: «Issue id to
                  depend on» CONTAINS the visible «Issue ID», so 2.5.3
                  holds, and the extra words say which end of the edge
                  the id belongs to — something the two-word label has no
                  room for. */}
              <input
                ref={addIdRef}
                className="detail-form-input"
                type="text"
                aria-label={t('deps.idAria')}
                placeholder={t('deps.idPlaceholder')}
                value={draftToId}
                onChange={(e) => setDraftToId(e.target.value)}
              />
            </label>
          </div>

          {/* The chosen type, spelled out. Seven types is more than a
              reader carries in their head, and a tooltip answers only
              the one they happen to hover.

              English only, and that is the maintainers' decision 4 in the
              epic rather than an omission: these sentences already exist
              as `DEP_TYPE_TOOLTIPS`, they are phrased from the FROM-side
              row exactly as this form needs, and a second Russian set
              would be a second place the seven definitions live. */}
          <p className="detail-form-hint">{DEP_TYPE_TOOLTIPS[draftType]}</p>

          <div className="detail-form-actions">
            <button type="button" className="action-button" onClick={closeAdd}>
              {t('deps.cancel')}
              <span className="detail-form-key" aria-hidden>
                Esc
              </span>
            </button>
            <button
              type="submit"
              className="action-button primary"
              disabled={addMut.isPending}
            >
              <IconPlus size={16} stroke={1.75} aria-hidden />
              {t('deps.add')}
              {/* «Enter», not `↵`. The canvas draws the return ARROW
                  here and the word «Esc» on the button beside it, and
                  the pair has to pick one: a key hint is a key NAME, and
                  a name is what the other half already says. It also
                  keeps a character out of a slot where it would be the
                  whole content, and «the platform draws U+21B5 at whatever
                  weight it likes». */}
              <span className="detail-form-key" aria-hidden>
                Enter
              </span>
            </button>
          </div>
        </form>
      ) : (
        // sk-285.7.2.55 — the same affordance, expanded-section
        // position. One element, placed in both: the collapsed row hands
        // it to `Section` as `emptyAction`, the expanded body renders it
        // here, and there is no second spelling to keep in step.
        addAffordance
      )}
    </Section>
  );
}

/**
 * One direction of the graph: a heading that names it, and the rows
 * under it.
 *
 * The heading is what carries the direction now (see the section's own
 * docblock), which is why an EMPTY direction still draws one: dropping
 * it would leave a reader unable to tell «no incoming edges» from «this
 * card does not show incoming edges». The word sits on the heading row
 * rather than under it, so an empty half costs a line, not three.
 */
function DirectionGroup({
  icon,
  label,
  emptyWord,
  edges,
  onClickIssue,
  onRemove,
  removing,
}: {
  icon: ReactNode;
  label: string;
  emptyWord: string;
  edges: DependencyEdge[];
  onClickIssue: (issueId: string, projectId: string) => void;
  /** Omitted for the incoming group — those edges are not ours to cut. */
  onRemove?: (edge: DependencyEdge) => void;
  removing?: { toId: string; type: DepType };
}) {
  return (
    <>
      <div className="detail-group-head">
        {icon}
        {label}
        {edges.length > 0 ? (
          <span className="detail-group-count">{edges.length}</span>
        ) : (
          <span className="detail-group-empty">{emptyWord}</span>
        )}
      </div>
      {edges.length > 0 ? (
        <ul className="detail-list">
          {edges.map((edge, i) => (
            <DependencyRow
              // sk-674.18 T055 — the hidden end of a redacted edge is a
              // synthetic `hidden-<k>`, not a real id: its key is its place
              // in the list, never the uniqueness of that id. No remove
              // control on it (`DependencyRow`): the server knows no edge
              // under the synthetic id.
              key={
                edge.redacted
                  ? `redacted|${edge.type}|${i}`
                  : `${edge.fromId}|${edge.toId}|${edge.type}`
              }
              edge={edge}
              onClickIssue={onClickIssue}
              onRemove={onRemove ? () => onRemove(edge) : undefined}
              removing={
                removing?.toId === edge.toId && removing?.type === edge.type
              }
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
