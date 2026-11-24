/**
 * Applying a theme whose font tokens name a hosted family loads that family
 * (themePresets.ts, `FontPreset.googleFamily`): `applyVariables` puts one
 * Google Fonts stylesheet link into `<head>` per family, with the family and
 * the weights the shell renders (`400;500;600;700`), and does it once per
 * page however often the theme is applied. A font stack that is not a hosted
 * preset (a local preset or a custom stack) only sets the CSS variable.
 *
 * jsdom does not fetch stylesheets, so nothing here touches the network:
 * the link element itself is what the browser would act on.
 *
 * The module keeps its "already linked" map for the page's lifetime, so each
 * test imports a fresh copy of it into an empty `<head>`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Runtime = typeof import('./themeRuntime');
let runtime: Runtime;

beforeEach(async () => {
  document.head.querySelectorAll('link').forEach((l) => l.remove());
  document.documentElement.removeAttribute('style');
  vi.resetModules();
  runtime = await import('./themeRuntime');
});

/**
 * The stylesheet links in `<head>`, read as what the browser would fetch:
 * the Google Fonts CSS endpoint, the family, its weights and `display`.
 * Parsed rather than compared as text, so the order of query parameters
 * is not part of the check.
 */
const fontLinks = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link')).map((l) => {
    const url = new URL(l.getAttribute('href') ?? '');
    const [family, axis] = (url.searchParams.get('family') ?? '').split(':');
    return {
      rel: l.rel,
      source: `${url.origin}${url.pathname}`,
      family,
      weights: axis?.replace(/^wght@/, '') ?? '',
      display: url.searchParams.get('display'),
    };
  });

const link = (family: string) => ({
  rel: 'stylesheet',
  source: 'https://fonts.googleapis.com/css2',
  family,
  weights: '400;500;600;700',
  display: 'swap',
});

const IBM_PLEX_SANS_UI = "'IBM Plex Sans', system-ui, sans-serif";
const FIRA_CODE_MONO = "'Fira Code', ui-monospace, Menlo, Consolas, monospace";

describe('applying font tokens', () => {
  test('a hosted UI font is linked with its family and weights', () => {
    runtime.applyVariables({ '--font-ui': IBM_PLEX_SANS_UI });

    expect(fontLinks()).toEqual([link('IBM Plex Sans')]);
  });

  test('a hosted monospace font is linked with its family and weights', () => {
    runtime.applyVariables({ '--font-mono': FIRA_CODE_MONO });

    expect(fontLinks()).toEqual([link('Fira Code')]);
  });

  test('applying the same fonts again adds no second link', () => {
    const theme = { '--font-ui': IBM_PLEX_SANS_UI, '--font-mono': FIRA_CODE_MONO };
    runtime.applyVariables(theme);
    runtime.applyVariables(theme);
    runtime.applyVariables({ '--font-ui': IBM_PLEX_SANS_UI });

    // One link per family, whatever order they were added in.
    const links = fontLinks();
    expect(links).toHaveLength(2);
    expect(links).toEqual(expect.arrayContaining([link('IBM Plex Sans'), link('Fira Code')]));
  });

  test.each([
    ['--font-ui', "'My Corporate Sans', sans-serif"],
    ['--font-mono', "'Geist Mono', ui-monospace, Menlo, Consolas, monospace"],
    ['--font-ui', "'IBM Plex Sans', sans-serif"],
  ])('%s = %s sets the variable and links nothing', (key, value) => {
    runtime.applyVariables({ [key]: value });

    expect(document.documentElement.style.getPropertyValue(key)).toBe(value);
    expect(fontLinks()).toEqual([]);
  });
});
