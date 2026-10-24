import { useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/**
 * Polls `/version.json` every 60 seconds and shows a sticky banner when
 * the server's version diverges from the one loaded at page start.
 * Tells the user to refresh so they get the new bundle/assets.
 *
 * `/version.json` is generated at Docker build time (Dockerfile
 * `ARG APP_VERSION` in `skein-web/Dockerfile`) and served by .NET with
 * `Cache-Control: no-store` (StaticFileOptions.OnPrepareResponse in
 * Program.cs). Every fetch returns the current deployed version, never
 * a stale cached copy.
 *
 * Pattern ported from a sibling React SPA that solved the same problem.
 */
export function VersionCheck() {
  const { t } = useTranslation('chrome');
  const [mismatch, setMismatch] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const clientVersion = useRef<string | null>(null);

  useEffect(() => {
    // cancelled flag mirrors AppVersionBadge — prevents setState after
    // unmount when an in-flight /version.json fetch resolves late.
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data: { version?: string } = await res.json();
        if (cancelled) return;
        const v = data.version;
        if (typeof v !== 'string' || v.length === 0) return;

        if (clientVersion.current == null) {
          // First load — just remember the baseline. We don't fire the
          // banner here even if version === "dev"; the divergence check
          // is what matters.
          clientVersion.current = v;
          return;
        }
        if (v !== clientVersion.current) {
          setMismatch(true);
        }
      } catch {
        // Network blip, CORS, parse error — silently skip. The next tick
        // will retry; we don't want a transient failure to surface as a
        // false-positive update banner.
      }
    };

    void check();
    const id = window.setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!mismatch || dismissed) return null;

  return (
    <div className="version-check-banner" role="alert">
      <span className="version-check-banner-text">{t('version.banner')}</span>
      <Button
        size="xs"
        variant="filled"
        color="orange"
        onClick={() => window.location.reload()}
      >
        {t('version.reload')}
      </Button>
      <Button
        size="xs"
        variant="default"
        onClick={() => setDismissed(true)}
      >
        {t('version.later')}
      </Button>
    </div>
  );
}

/**
 * Tiny badge next to the Skein logo showing the deployed version (from
 * `/version.json`). Fetched once on mount — no polling here, VersionCheck
 * handles the mismatch-detection separately.
 *
 * Returns null when the version cannot be fetched, so the header layout
 * stays compact in dev builds where the file may not exist.
 */
export function AppVersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data: { version?: string } = await res.json();
        if (!cancelled && typeof data.version === 'string' && data.version.length > 0) {
          setVersion(data.version);
        }
      } catch {
        // silent — badge just won't render
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (version == null) return null;

  return (
    <span className="header-version-badge" aria-label={`Skein version ${version}`}>
      v{version}
    </span>
  );
}
