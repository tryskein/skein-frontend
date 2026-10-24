/**
 * sk-421.1 SC-007 / US-11 — the three frontend places that type an issue
 * source (the detail DTO field, the task-list `source` param and the
 * `/search` `source` param) accept exactly the server's closed set
 * `human` / `agent_directed` / `agent_autonomous`.
 *
 * A compile-time pin, checked by `npm run typecheck` (`tsc -b`, which
 * covers `src/**`) and never executed: if any place still admits the
 * legacy `'agent'`, its `@ts-expect-error` below becomes unused and the
 * type build fails; if any place lacks a server value, the positive
 * assignment fails. Nothing imports this module, so it is not bundled.
 */
import type { IssueDetail, ListIssuesParams } from './issues';
import type { SearchParams } from './search';

type DetailSource = IssueDetail['source'];
type ListSource = NonNullable<ListIssuesParams['source']>;
type SearchSource = NonNullable<SearchParams['source']>;

export const detailSourcePin: DetailSource[] = [
  'human',
  'agent_directed',
  'agent_autonomous',
  // @ts-expect-error — legacy value outside the server set
  'agent',
];

export const listSourcePin: ListSource[] = [
  'human',
  'agent_directed',
  'agent_autonomous',
  // @ts-expect-error — legacy value outside the server set
  'agent',
];

export const searchSourcePin: SearchSource[] = [
  'human',
  'agent_directed',
  'agent_autonomous',
  // @ts-expect-error — legacy value outside the server set
  'agent',
];
