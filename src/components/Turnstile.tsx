import { useEffect, useRef } from 'react';

/**
 * sk-674.18 — Cloudflare Turnstile, explicit rendering (plan "Samples":
 * the script from `challenges.cloudflare.com` is loaded only when a site
 * key is configured; not an npm dependency).
 *
 * Moved here from T059 into T057 (lead's decision, sk-674.18): the
 * invitation form (screens 2.4) shows it on `captcha_required` before the
 * public pages of T059 exist; T059 reuses this component.
 *
 * The widget hands its token to `onToken` once the challenge passes, and
 * `null` when the token expires or the challenge fails — a token is
 * single-use and lives 300 s, so the caller sends it with the next request
 * only. The script tag is added once per page and shared by every widget;
 * a widget is removed on unmount.
 *
 * One mount is one challenge: the caller starts a new one by remounting
 * (a new `key`) — after a refusal of the token, Cloudflare's guidance is a
 * fresh widget before a retry. An expired token is not refreshed by the
 * widget on its own (`refresh-expired: manual`): a new token needs the
 * person, so nothing is sent without them.
 *
 * A removed widget is dead: its callbacks, which Turnstile may still hold
 * and call, reach nobody — closing the form or leaving the page before the
 * first token sends nothing.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'refresh-expired': 'auto' | 'manual' | 'never';
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** The Turnstile API, the script loaded on first need. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile: script loaded without the API'));
    };
    script.onerror = () => {
      // A later widget may try again (the network may come back).
      scriptPromise = null;
      script.remove();
      reject(new Error('turnstile: script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileProps {
  /** `turnstileSiteKey` of `/api/auth/config`. */
  siteKey: string;
  /** The token once the challenge passes; null when it expires or fails. */
  onToken: (token: string | null) => void;
  /** The script could not be loaded — the caller says so. */
  onLoadError?: () => void;
  /**
   * The id of the caller's caption of the check: the widget's container
   * becomes a group named by it, so the check is tied to what it is for.
   */
  labelledBy?: string;
  className?: string;
}

export function Turnstile({ siteKey, onToken, onLoadError, labelledBy, className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-rendering the widget on every parent render.
  const onTokenRef = useRef(onToken);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onTokenRef.current = onToken;
    onLoadErrorRef.current = onLoadError;
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || containerRef.current === null) return;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            if (!cancelled) onTokenRef.current(token);
          },
          'error-callback': () => {
            if (!cancelled) onTokenRef.current(null);
          },
          'expired-callback': () => {
            if (!cancelled) onTokenRef.current(null);
          },
          'refresh-expired': 'manual',
        });
      },
      () => {
        if (!cancelled) onLoadErrorRef.current?.();
      },
    );
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <div
      ref={containerRef}
      className={className}
      role={labelledBy !== undefined ? 'group' : undefined}
      aria-labelledby={labelledBy}
    />
  );
}
