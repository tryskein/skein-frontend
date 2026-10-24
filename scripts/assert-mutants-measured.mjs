#!/usr/bin/env node
/**
 * sk-529 — "green != executed", applied to the mutation run.
 *
 * ─── The defect this exists to remove ──────────────────────────────
 *
 * The mutation job answers a question `test-unit` cannot: would the
 * assertions NOTICE a regression. It has been non-blocking on purpose
 * (`allow_failure`), and the condition for making it blocking is written
 * above the job. That part is a decision, not a bug.
 *
 * The bug is that the job could not tell «measured, and the score is
 * low» from «measured nothing at all». Between ~2026-09-05 and
 * 2026-09-20 it was the second: a `.md` file pulled into Vite's module
 * graph crashed the runner in the DRY RUN, before a single mutant was
 * tested. `allow_failure` painted that yellow, exactly as it paints a
 * thin score, and for two weeks the project believed it had mutation
 * coverage of its assertion strength. It had none. A silent instrument
 * and a working one look identical — which is the whole class the sk-489
 * run was about, here one level up, at the tools.
 *
 * The project's own canon already forbids this for integration tests:
 *
 *   "The harness and the CI job must fail if 0 tests were executed —
 *    regardless of the green exit code of the framework."
 *
 * Same rule, different runner. This script is the missing guard.
 *
 * ─── Three outcomes, not two ───────────────────────────────────────
 *
 *   1. mutants measured                                  → Stryker exits
 *      0. The config sets no `thresholds.break` (sk-554: the score is
 *      not used), so a measured run never fails on what it found.
 *   2. Stryker reported an error after measuring         → Stryker exits
 *      1. That is the soft failure `allow_failure` is FOR; this script
 *      says nothing about it.
 *   3. no mutants measured                               → a broken
 *      instrument, not a soft failure. This script exits
 *      {@link NOT_MEASURED_EXIT}, a code the job's `allow_failure`
 *      deliberately does not list, so the pipeline goes RED.
 *
 * Stryker exits 1 for a crash (an unhandled rejection in the CLI action)
 * whether it happens before the first mutant or after the last, and would
 * use the same code for a break threshold if one were ever set again. The
 * exit code therefore CANNOT be the discriminator, and this script does
 * not try to read it — it reads what the run left behind instead.
 *
 * ─── Two independent signals, because one of them has a blind spot ─
 *
 *  • **The instrumentation line.** `Instrumented N source file(s) with M
 *    mutant(s)` is printed before testing starts, so it proves the
 *    `mutate` slice resolved to something. M = 0 means the slice matched
 *    no file — a config typo, a moved module — and everything after it
 *    is vacuous.
 *
 *    Its blind spot is exactly the 2026-09 failure: the line is printed
 *    BEFORE the dry run, so a dry-run crash or timeout leaves it in the
 *    log looking healthy while nothing was ever tested.
 *
 *  • **The JSON report.** `reports/mutation/mutation.json` is written
 *    only by a run that completed, and `stryker.config.mjs` already
 *    names it as the machine-readable artefact «anything that wants to
 *    read the run — a CI gate, a diff of survivors between branches»
 *    should read. A mutant counts as MEASURED only if its status is a
 *    verdict a test produced: killed, survived, timed out, or errored at
 *    runtime. `NoCoverage` and `Ignored` are not verdicts — no test ran
 *    against them — so a report made entirely of those measured nothing
 *    about assertion strength and is rejected too.
 *
 * Neither signal alone covers both ways the run can die silently, so
 * both are required.
 *
 * Usage:
 *   node scripts/assert-mutants-measured.mjs <stryker-log> <mutation.json>
 *
 * Exit codes: 0 = the run measured something; 9 = it did not; 2 = this
 * script was called wrong.
 */

import { readFileSync, existsSync } from 'node:fs';

/**
 * The code a run that measured nothing exits with.
 *
 * Deliberately neither 0 nor 1: the CI job softens ONLY Stryker's own 1
 * (`allow_failure: exit_codes: 1`), so a code outside that list is the
 * one thing `allow_failure` cannot swallow.
 */
export const NOT_MEASURED_EXIT = 9;

/** Statuses that mean a test actually ran against the mutant. */
export const MEASURED_STATUSES = ['Killed', 'Survived', 'Timeout', 'RuntimeError'];

/** `Instrumented 11 source file(s) with 700 mutant(s)` → 700. */
export function instrumentedMutants(log) {
  // Last occurrence wins: a re-run appended to the same log would
  // otherwise be judged on its first pass.
  const matches = [...log.matchAll(/Instrumented\s+\d+\s+source file\(s\)\s+with\s+(\d+)\s+mutant\(s\)/g)];
  if (matches.length === 0) return null;
  return Number.parseInt(matches[matches.length - 1][1], 10);
}

/**
 * How many mutants the report says were actually tested, and how many it
 * holds at all.
 *
 * Throws rather than returning zero when the file cannot be read as a
 * report: «unreadable» and «empty» are different findings and only one
 * of them is about the tests.
 */
export function reportCounts(json) {
  const report = JSON.parse(json);
  const files = report.files ?? {};
  if (typeof files !== 'object') throw new Error('report has no `files` object');
  let total = 0;
  let measured = 0;
  for (const file of Object.values(files)) {
    for (const mutant of file.mutants ?? []) {
      total += 1;
      if (MEASURED_STATUSES.includes(mutant.status)) measured += 1;
    }
  }
  return { total, measured };
}

/** The whole check, as data, so the test can assert the reason too. */
export function check(logPath, reportPath) {
  if (!existsSync(logPath)) {
    return { ok: false, reason: `the run left no log at ${logPath}` };
  }
  const instrumented = instrumentedMutants(readFileSync(logPath, 'utf8'));
  if (instrumented === null) {
    return {
      ok: false,
      reason:
        'the log has no "Instrumented N source file(s) with M mutant(s)" line — '
        + 'the run did not get as far as instrumenting the slice',
    };
  }
  if (instrumented === 0) {
    return {
      ok: false,
      reason: 'the slice instrumented 0 mutants — `mutate` matched no source',
    };
  }
  if (!existsSync(reportPath)) {
    return {
      ok: false,
      reason:
        `instrumented ${instrumented} mutants but wrote no report at ${reportPath} — `
        + 'the run died between instrumentation and the first verdict '
        + '(a dry-run crash or timeout looks exactly like this)',
    };
  }
  let counts;
  try {
    counts = reportCounts(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `${reportPath} is not a readable mutation report: ${err.message}` };
  }
  if (counts.measured === 0) {
    return {
      ok: false,
      reason:
        `instrumented ${instrumented} mutants and the report holds ${counts.total}, `
        + 'but none of them carries a verdict a test produced '
        + `(${MEASURED_STATUSES.join('/')}) — nothing was measured`,
    };
  }
  return {
    ok: true,
    reason: `instrumented ${instrumented}; ${counts.measured} of ${counts.total} mutants measured`,
  };
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const [logPath, reportPath] = process.argv.slice(2);
  if (!logPath || !reportPath) {
    console.error('usage: assert-mutants-measured.mjs <stryker-log> <mutation.json>');
    process.exit(2);
  }
  const result = check(logPath, reportPath);
  if (result.ok) {
    console.log(`✓ mutation run measured something — ${result.reason}`);
    process.exit(0);
  }
  console.error(`✗ ZERO mutants measured — ${result.reason}`);
  console.error(
    'This is a broken instrument, not a low score: a run that measured nothing '
    + 'is indistinguishable from a healthy one unless the job says so.',
  );
  process.exit(NOT_MEASURED_EXIT);
}
