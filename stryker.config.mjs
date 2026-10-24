// @ts-check
/**
 * Mutation testing for skein-frontend (Stryker).
 *
 * ─── What this measures, and why line coverage does not ────────────
 *
 * A green suite proves the tests RAN, not that they would notice a
 * regression. Stryker answers the second question directly: it edits the
 * production source one small change at a time (`>` → `>=`, `&&` → `||`,
 * a block emptied, a string literal blanked) and re-runs the tests that
 * touch that line. A mutant KILLED means some test went red — the
 * behaviour is genuinely guarded. A mutant SURVIVED means the code could
 * be wrong in that exact way and every test would still pass, so whatever
 * covers that line is asserting something weaker than it looks.
 *
 * ─── How a run is read: the survivors, not a score ─────────────────
 *
 * CLAUDE_TEST_GUIDELINES.md, part II: the percentage of killed mutants is
 * not used, and no threshold is set. That is why this config has no
 * `thresholds.break` (Stryker's default is `null`: the score never fails
 * the run). What a run is read for is the list of SURVIVED mutants — the
 * clear-text reporter prints each one with its file, line and replacement
 * — and each gets a verdict:
 *
 *   real gap     → strengthen the assertion that should have killed it;
 *   equivalent   → the edit cannot change behaviour; record it below
 *                  with the reason, verified by hand;
 *   unproductive → e.g. a log message; say so in the review, move on.
 *
 * «No coverage» is a different question (no test reaches the line), and a
 * build failure or a timeout is not a verdict.
 *
 * Locally the run is aimed at the task's diff (`--mutate` with the changed
 * files; the command is in this repo's CLAUDE.md, section «Testing»).
 * In CI the job runs the fixed slice below, advisory only.
 *
 * ─── Why `coverageAnalysis: "perTest"` ─────────────────────────────
 *
 * This is the single lever that makes the run affordable, and it is not
 * a quality trade-off. Without it ("all") Stryker executes the ENTIRE
 * vitest suite once per mutant. With "perTest" Stryker instruments a
 * single dry run, records which tests execute which statements, and then
 * for each mutant runs ONLY the tests that actually reach it. The verdict
 * is identical: a test that never touches the mutated line cannot kill
 * the mutant, so skipping it changes nothing but the clock.
 *
 * The @stryker-mutator/vitest-runner ships "perTest" as its own
 * recommended default (`initStrykerConfig` in its package.json).
 *
 * The one requirement it puts on us: tests must not leak state into each
 * other, because Stryker runs SUBSETS of them in isolation. vitest gives
 * us that by default (`isolate: true` — a fresh module registry and jsdom
 * per test file) and vitest.config.ts does not override it; a test that
 * only passes because an earlier file ran first would show up here as a
 * false "killed", so keep it that way.
 *
 * ─── The CI slice, and what admits a file to it ────────────────────
 *
 * Mutation testing costs roughly (mutants x covering tests), so the CI
 * job does not point at all of src/. The slice started as the pure
 * tree/sort logic — no React, no network, no timers — where every
 * surviving mutant is a concrete, fixable assertion gap rather than an
 * artifact of a component harness.
 *
 * **A file joins `mutate` once its survivors are triaged** — each one
 * killed by an assertion or recorded below as equivalent. A file with an
 * untriaged pile of survivors would bury every new survivor the job is
 * there to show under old ones nobody is going to read.
 *
 * Known candidates still outside the slice, each with a body of
 * untriaged survivors and uncovered code: `DependenciesSection.tsx`,
 * `AttachmentList.tsx`, `AttachmentDropzone.tsx`, `CommentsThread.tsx`.
 * Their current survivors are one command away:
 * `npx stryker run stryker.config.mjs --mutate '<file>'`.
 *
 * ─── Equivalent mutants, recorded rather than killed ───────────────
 *
 * Verdicts on surviving mutants judged EQUIVALENT or UNPRODUCTIVE are not
 * recorded in this file, which is configuration. Real gaps are not recorded
 * at all — they are killed by a test.
 *
 * ─── The trap that widening actually sprang ────────────────────────
 *
 * Guards that read a COMPONENT'S SOURCE as text (removed at sk-540.11)
 * break the run the moment their subject joins `mutate`.
 * Stryker instruments every file in `mutate`, so such a guard ends up
 * matching against `// @ts-nocheck function stryNS_9fa48…` — and a guard that fails in
 * the DRY RUN takes the whole measurement down with it, before a single
 * mutant is tested. That is what `CommentsThread.tsx` did on the first
 * combined run.
 *
 * The boundary is narrower than «source scans break», and it was
 * measured rather than guessed, by reading the instrumented copy out of
 * `.stryker-tmp`:
 *
 *   `className="empty-section-add"`  — a JSX ATTRIBUTE string literal.
 *      NOT mutated, survives instrumentation byte for byte.
 *   `classNames={{ input: 'comment-composer-input' }}` — a literal
 *      inside a JSX EXPRESSION CONTAINER. Mutated, and therefore
 *      rewritten into a `stryMutAct_9fa48(…) ? … : …` ternary that no
 *      regex written against the original will match.
 *
 * Those two claims moved to `CommentsThread.test.tsx` and are asserted
 * on the RENDER now, which is both instrumentation-proof and a stronger
 * statement: the source proves the prop is written, the render proves
 * the class reaches the element Mantine draws.
 *
 * ─── Known blind spot: no numeric-literal mutator ─────────────────
 *
 * The default mutator set is ArithmeticOperator, ArrayDeclaration,
 * ArrowFunction, AssignmentOperator, BlockStatement, BooleanLiteral,
 * CallExpression, ConditionalExpression, EqualityOperator,
 * LogicalOperator, MethodExpression, ObjectLiteral, OptionalChaining,
 * Regex, StringLiteral, UnaryOperator, UpdateOperator — and NOT a number
 * literal. So `at(index, 0)` is never tried as `at(index, lastCol)`, and
 * an off-by-one baked into a CONSTANT rather than into an operator is
 * invisible to this tool. A run with no survivors therefore does not
 * prove an off-by-one in a constant would be caught.
 *
 * Docs: https://stryker-mutator.io/docs/stryker-js/configuration/
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  // `json` alongside `html`: the HTML report embeds its data as a JS
  // expression (Stryker splits the literal `</script>` with `"<" + "/..."`
  // so the page stays parseable), which is deliberately NOT parseable with
  // JSON.parse. Anything that wants to read the run — a CI gate, a diff of
  // survivors between branches — reads reports/mutation/mutation.json.
  reporters: ['html', 'json', 'clear-text', 'progress'],

  testRunner: 'vitest',
  vitest: {
    // The suite's real config — jsdom env, globals, src/test/setup.ts.
    // Stryker must run the tests exactly as CI does, or a mutant could
    // be "killed" by a setup difference rather than by an assertion.
    configFile: 'vitest.config.ts',
  },

  // See the header: only worth paying for the tests that reach the mutant.
  coverageAnalysis: 'perTest',
  // Incremental mode: reuse a mutant's result when neither its
  // code nor the tests that covered it changed — a re-run after adding gap
  // tests then re-tests only what moved, not the whole slice. The file is
  // under reports/ (gitignored, dockerignored); absent → a full run, which
  // is what CI gets.
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',

  // ── How many test runners at once ───────────────────────────────
  //
  // Pinned, not left to the default, and the reason is MEMORY rather
  // than cores. Stryker's default is `cpuCount - 1`, and `os.cpus()`
  // inside a container reports the machine's cores, not the container's
  // budget — so the default sizes the pool against a number that has
  // nothing to do with what the pool is allowed to use.
  //
  // Measured, on the dev container (12 cores, 7.9 GB) with the slice
  // below: at the default 11 runners a child was SIGKILLed mid-run with
  // 6 of 7.9 GB resident — an OOM kill, which Stryker reports as a
  // runner crash and which lands somewhere in the results. A jsdom
  // runner holding this suite sits around half a gigabyte, so the
  // ceiling is memory and 6 leaves headroom for the rest of the box.
  //
  // A machine with more memory can raise it for one run without editing
  // this file: `npx stryker run --concurrency N`. Do NOT raise the
  // committed value on the strength of one fast machine: a runner killed
  // by the OOM killer turns its mutants into errors, not verdicts.
  concurrency: 6,

  // ── The slice under test ────────────────────────────────────────
  //
  // Two groups; the header says what admits a file.
  //
  // 1. Pure logic behind the Tasks treegrid: row flattening, tree
  //    assembly, column model + width layout, sorting, keyboard
  //    navigation, and the aria-setsize/posinset numbering.
  // 2. The issue card's section frame and the two sections whose tests
  //    have their survivors triaged, plus the dependency row. The
  //    header names the files still outside and why.
  mutate: [
    'src/lib/treeRowPositions.ts',
    'src/lib/treeColumns.ts',
    'src/lib/treeColumnLayout.ts',
    'src/lib/taskSort.ts',
    'src/lib/treeGridKeyboardNav.ts',
    'src/lib/buildIssueTree.ts',
    'src/lib/flattenTree.ts',
    'src/pages/shell/details/Section.tsx',
    'src/pages/shell/details/sections/AttachmentsSection.tsx',
    'src/pages/shell/details/sections/CommentsSection.tsx',
    'src/components/DependencyRow.tsx',
  ],

  // Sandbox hygiene: Stryker copies the project to .stryker-tmp and
  // symlinks node_modules. Keep build output and reports out of the copy.
  ignorePatterns: ['dist', 'coverage', 'reports', '.stryker-tmp'],
  tempDirName: '.stryker-tmp',
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },

  // The suite is jsdom-heavy; a mutant that hits an infinite loop must be
  // cut off rather than hang the run.
  timeoutMS: 20000,
  timeoutFactor: 2,

  // ── The DRY-RUN clock, which is a different clock ────────────────
  //
  // `timeoutMS` above bounds ONE mutant. This bounds the single
  // instrumented run that precedes every measurement — the one that
  // records which test touches which statement, and therefore runs the
  // WHOLE suite once, instrumented.
  //
  // Raised from Stryker's 5-minute default because the run no longer
  // fits in it: MEASURED 2026-09-21 on this slice, «Initial test run
  // succeeded. Ran 2073 tests in 5 minutes and 56 seconds». The default
  // does not fail the way a timeout usually does — it prints «Initial
  // test run timed out!» and exits with no mutant tested,
  // which reads like the tool being broken rather than like a clock
  // running out. That is exactly how it presented when this slice grew
  // by one file.
  //
  // 15 is ~2.5× the measurement, not a number chosen to be large: the
  // dry run is once per measurement, so headroom here costs nothing on
  // a healthy run, while a slower CI box or a suite that grows another
  // hundred tests must not silently stop producing results. Re-measure
  // it whenever the SUITE grows materially — this bound follows the
  // test count, not the mutant count.
  dryRunTimeoutMinutes: 15,
};
