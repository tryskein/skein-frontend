/**
 * sk-421.2.8 — matrix row 24 (US-4 client, Q4/D-2, NFR "the task column does not
 * pay"): serialization of the "include blockers" flag in the tree request.
 *
 * The epic section asks for the `blockers` field with the parameter `includeBlockers=true`;
 * the task column does not ask for it and must send exactly the former URL. So
 * both halves are checked: a true flag REACHES the URL, while `false` and
 * an absent field give a URL identical to the URL without the flag.
 *
 * The stub is the global `fetch` only; the `issues.ts` module is not mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DepType } from './dependencies';
import { fetchIssueTree, type FetchIssueTreeArgs } from './issues';

const PROJECT_UUID = '55362761-87b3-435b-a7d3-29d1d9491c00';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** URL of the only request that went into `fetch`. */
async function urlFor(args: FetchIssueTreeArgs): Promise<string> {
  fetchSpy.mockClear();
  await fetchIssueTree(args);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  return String(fetchSpy.mock.calls[0][0]);
}

/** Request parameters from the URL (the path is relative — the base is needed only by the parser). */
function paramsOf(url: string): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams;
}

const BASES: Array<{ name: string; args: FetchIssueTreeArgs }> = [
  {
    name: 'cross-project variant',
    args: { rootId: 'sk-42', types: ['parent-child'] as DepType[], maxDepth: 1 },
  },
  {
    name: 'project variant',
    args: { projectId: PROJECT_UUID, types: ['parent-child', 'blocks'] as DepType[] },
  },
];

describe('fetchIssueTree — serialization of includeBlockers (row 24)', () => {
  for (const { name, args } of BASES) {
    test(`${name}: includeBlockers:true → includeBlockers=true in the URL`, async () => {
      const url = await urlFor({ ...args, includeBlockers: true });
      expect(paramsOf(url).getAll('includeBlockers')).toEqual(['true']);
    });

    test(`${name}: includeBlockers:false → URL without the parameter, as without the flag`, async () => {
      const without = await urlFor({ ...args });
      const withFalse = await urlFor({ ...args, includeBlockers: false });
      expect(paramsOf(withFalse).has('includeBlockers')).toBe(false);
      expect(withFalse).toBe(without);
    });

    test(`${name}: field absent → URL without the parameter`, async () => {
      const url = await urlFor({ ...args });
      expect(paramsOf(url).has('includeBlockers')).toBe(false);
      expect(url).not.toContain('includeBlockers');
    });

    test(`${name}: the flag does not touch the other request parameters`, async () => {
      // With the flag the URL is the URL without the flag plus exactly one parameter.
      const without = paramsOf(await urlFor({ ...args }));
      const withFlag = paramsOf(await urlFor({ ...args, includeBlockers: true }));
      withFlag.delete('includeBlockers');
      expect(withFlag.toString()).toBe(without.toString());
    });
  }
});
