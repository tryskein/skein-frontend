/**
 * parseUserAgent — sk-62.3.8.
 *
 * Best-effort, dependency-free User-Agent → short human label parser for the
 * push device list. Turns the unreadable raw UA into something like
 * "Chrome 149 · Windows" / "Firefox 151 · Windows" / "Safari 17 · macOS".
 *
 * This is heuristic, not a full UA database — we only need enough to tell
 * one device row apart from another. Brave reports a UA byte-identical to
 * Chrome's, so a Brave device WILL show as "Chrome"; that's a UA limitation,
 * not a bug, and we deliberately do not try to detect it for stored rows.
 *
 * Detection order matters:
 *   - browser: Edge (Edg/) BEFORE Chrome (Edge embeds "Chrome/"); Chrome
 *     BEFORE Safari (Chrome embeds "Safari/"); then Firefox; then Safari.
 *   - OS: Android BEFORE Linux (Android UAs contain "Linux"); iOS via
 *     iPhone/iPad/iPod; Windows; macOS; Linux.
 *
 * Falls back to the raw UA (truncated) when nothing matches, so the row is
 * never blank.
 */

const MAX_FALLBACK = 60;

interface BrowserMatch {
  name: string;
  /** First capture group is the major version, when present. */
  pattern: RegExp;
}

// Ordered: more specific / embedded-token browsers first.
const BROWSERS: BrowserMatch[] = [
  { name: 'Edge', pattern: /Edg(?:[Ai]?|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /OPR\/(\d+)/ },
  { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/(\d+)/ },
  // Safari version lives in "Version/<n>", not "Safari/<n>" (which is the
  // WebKit build). Only reached when Chrome/Edge/etc. didn't match.
  { name: 'Safari', pattern: /Version\/(\d+)[.\d]*\s+(?:Mobile\/\S+\s+)?Safari/ },
];

function detectBrowser(ua: string): string | null {
  for (const b of BROWSERS) {
    const m = ua.match(b.pattern);
    if (m) {
      return m[1] ? `${b.name} ${m[1]}` : b.name;
    }
  }
  // Bare Safari with no Version/ token (rare) — still better than nothing.
  if (/Safari\//.test(ua) && !/Chrome|Chromium/.test(ua)) return 'Safari';
  return null;
}

function detectOS(ua: string): string | null {
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/(iPhone|iPad|iPod)/.test(ua)) return 'iOS';
  // "Mac OS X" also appears on iOS Safari, but iOS is caught above.
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/(CrOS)/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

/**
 * Turn a raw User-Agent string into a short "Browser version · OS" label.
 * Empty / unparseable input falls back to the (truncated) raw UA, or a
 * generic placeholder when there's nothing at all.
 */
export function parseUserAgent(ua: string): string {
  const trimmed = (ua ?? '').trim();
  if (trimmed === '') return 'unknown device';

  const browser = detectBrowser(trimmed);
  const os = detectOS(trimmed);

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;

  return trimmed.length > MAX_FALLBACK
    ? `${trimmed.slice(0, MAX_FALLBACK)}…`
    : trimmed;
}
