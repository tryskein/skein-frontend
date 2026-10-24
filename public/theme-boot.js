/*
 * Boot attributes — runs synchronously before React mounts so that
 * <html data-theme="..." data-density="..." data-width-mode="..."> is set
 * before first paint. Three separate questions, one script, for one
 * reason: it is the only code in the app that runs before the first frame.
 *
 * THEME priority (sk-285.7.2.48):
 *   1) localStorage 'skein.theme.boot' — the SERVER preference, written
 *      by `useTheme` (src/lib/themeBootCache.ts). Within it: a custom
 *      theme paints its own variables map; otherwise the stored
 *      built-in.
 *   2) localStorage 'skein.theme' — «the user picked this, here». The
 *      only source before the first login, and the login screen's.
 *   3) prefers-color-scheme
 *   4) fallback 'light'
 *
 * ⚠ Step 1 is the whole point, and it is a MEASURED fix rather than a
 * tidy-up. Without it this script had no access to the server-side
 * preference at all, so an account on the dark theme, in a browser
 * where nobody had picked one, painted its first frame from the OS and
 * repainted when /me/theme landed: measured 24.2ms light → first-paint
 * 244.0ms light → 301.2ms dark, on a dev server, and reported by two
 * independent auditors as «starts light, switches after ~2s». The
 * script always ran, and ran early; it read the wrong source.
 *

 * WIDTH MODE (sk-285.7 T017, plan decision R8) mirrors `widthModeFor`
 * in src/lib/useWidthMode.ts. React cannot do this job: `useWidthMode`
 * writes the attribute in a layout effect, which is before the browser
 * PAINTS but after the app has mounted and rendered once — so a phone
 * would render one frame of a desktop layout, and the spec rules that
 * out in as many words ("a narrow screen does not get the desktop layout even for
 * one frame"). There is no SSR in this project to put it in
 * either. So it goes here, ahead of everything.
 *
 * `window.innerWidth` rather than two `matchMedia` calls, deliberately:
 * this is a ONE-SHOT reading with no subscription to keep, and MQ4
 * defines the `width` feature for continuous media as the viewport
 * width including a rendered scrollbar — which is exactly what
 * `innerWidth` reports. `useWidthMode.ts` says the same from its side,
 * and `useWidthMode.test.ts` pins that the two readers agree.
 *
 * ⚠ THE TWO THRESHOLDS BELOW ARE DUPLICATED NUMBERS. Nothing here can
 * read `src/index.css` or `useWidthMode.ts`: this file is served raw to
 * the browser, is not part of the bundle and has no imports. They are
 * held to the stylesheet and to the module by a guard —
 * `src/pages/shell/__tests__/BootWidthMode.test.ts` — which parses this
 * file, and then RUNS it, so a threshold that drifts and a comparison
 * that drifts both fail the build. Change one number here and you have
 * a red test, not a silent split between the first frame and every
 * frame after it.
 *
 * Lives in /public so a strict CSP `script-src 'self'` accepts it
 * (no nonce / 'unsafe-inline' required). Adds one extra HTTP RTT
 * on first load — tiny vs the security win, since the browser
 * fetches it before React's main bundle.
 */
(function () {
  /* prefers-color-scheme, or 'light' where matchMedia is missing —
   * steps 3 and 4 of the priority order in the header. */
  function osTheme() {
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  try {
    var t = null;

    /* 1. The server's preference, as of the last load. The shape is
     * duplicated from src/lib/themeBootCache.ts for the same reason the
     * width thresholds below are duplicated — no imports here — and is
     * pinned to that module by ThemeBootFirstFrame.test.ts, which
     * parses this file AND runs it against records the module wrote. */
    var raw = window.localStorage.getItem('skein.theme.boot');
    if (raw) {
      /* Its OWN try, inside the outer one, and not decoration: a record
       * that does not parse (a write truncated by a full quota, junk
       * from another origin's tooling) would otherwise abort the whole
       * block and land in the catch-all below, which paints 'light' and
       * throws away the user's own `skein.theme` pick with it. An
       * unreadable record is a record we do not have — nothing more. */
      var c = null;
      try {
        c = JSON.parse(raw);
      } catch (parseError) {
        c = null;
      }
      if (c && c.v === 1) {
        if (c.mode === 'custom' && c.vars) {
          /* Paint the custom map itself. React strips and re-applies it
           * after mount (themeRuntime.stripAppliedVariables covers keys
           * it did not track — this script is the writer that comment
           * anticipated), so a stale map costs one reconciliation and
           * never outlives it. */
          var root = document.documentElement;
          for (var k in c.vars) {
            if (
              Object.prototype.hasOwnProperty.call(c.vars, k) &&
              k.charAt(0) === '-' &&
              k.charAt(1) === '-'
            ) {
              root.style.setProperty(k, c.vars[k]);
            }
          }
          root.style.colorScheme = c.base === 'dark' ? 'dark' : 'light';
          t = 'custom';
        } else if (c.builtin === 'light' || c.builtin === 'dark') {
          t = c.builtin;
        }
      }
    }

    /* 2-4. No server record yet: first visit, the login screen, or a
     * cleared cache after logout. */
    if (!t) {
      var stored = window.localStorage.getItem('skein.theme');
      t = stored === 'light' || stored === 'dark' ? stored : osTheme();
    }

    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  /* DENSITY (sk-551.7). The person's density lives in the profile and
   * arrives long after the first frame; a compact user would watch every
   * load start at the normal sizes and then shrink. So the last answer
   * this browser saw — written by `useDensitySync` through
   * src/lib/densityBootCache.ts, whose record shape is duplicated here for
   * the reason the theme's is — paints the first frame. "Normal" is the
   * absence of the attribute, so only `compact` is written.
   *
   * The record names its user, and this script cannot check it: nobody
   * knows who is signed in yet. It paints the last signed-in person's
   * density; the app compares the user the moment the session is known
   * and drops a stranger's record (lib/useDensity.ts#useDensitySync), and
   * a logout deletes it. Pinned to the module by DensityBootFirstFrame.test.tsx,
   * which runs this file against records the module wrote.
   *
   * Its own try, outside the theme's: a blocked localStorage or a broken
   * record costs the density — the normal sizes — and nothing else. */
  try {
    var draw = window.localStorage.getItem('skein.density.boot');
    if (draw) {
      var d = JSON.parse(draw);
      if (d && d.v === 1 && typeof d.userId === 'string' && d.userId !== '' &&
        d.density === 'compact') {
        document.documentElement.setAttribute('data-density', 'compact');
      }
    }
  } catch (densityError) {
    /* no record we can read — the normal density, i.e. no attribute */
  }

  /* --app-min-width in src/index.css; DESKTOP_MIN_PX in useWidthMode.ts.
   * The app floor: at or above it the desktop layout fits. */
  var DESKTOP_MIN_PX = 1284;
  /* --bp-mobile in src/index.css; MOBILE_MIN_PX in useWidthMode.ts. */
  var MOBILE_MIN_PX = 768;

  /* Outside the try above on purpose: a blocked localStorage must not
   * cost the width mode, and it would if this sat inside a block that
   * throws on its first statement.
   *
   * Widest-first, so a threshold belongs to the UPPER range — the same
   * order and the same comparisons as `widthModeFor`, which is what
   * makes the boundary answer identical on the first frame and on every
   * frame after it. No default-to-mobile before the reading: that would
   * hand every desktop a frame of the narrow layout to fix the mirror
   * problem on phones. */
  var w = window.innerWidth;
  document.documentElement.setAttribute(
    'data-width-mode',
    w >= DESKTOP_MIN_PX ? 'desktop' : w >= MOBILE_MIN_PX ? 'tablet' : 'mobile',
  );
})();
