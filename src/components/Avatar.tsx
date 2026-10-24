import { CSSProperties } from 'react';

/**
 * Avatar renders a square initial-chip with a deterministic ember-tinted
 * background colour. Used wherever a user appears in a list / row /
 * comment header — Inbox, Activity, Members, Comments, issue assignee.
 *
 * Decisions:
 *   - Square (not round) — matches the CRT / TUI aesthetic.
 *   - 1px ember accent border, JetBrains Mono initials.
 *   - Three sizes (sm 18px / md 26px / lg 40px) cover every host.
 *   - Fixed 8-colour palette (Q4) — picked to all read against the
 *     dark terminal bg, no random HSL hash that risks colour clashes.
 *   - Agent actors get a small ">" glyph at bottom-right; system
 *     actors fall back to a muted grey background so non-human
 *     identity reads at a glance.
 *
 * Always paired with the textual @username (UserMention) for
 * accessibility — Avatar alone is not a substitute for a screen-reader
 * label. See InboxItem / Activity row composition.
 */

/**
 * `header` is the app header's account chip and nothing else — handoff
 * §6 "avatar 32px square r8 --primary with mono initials" and §8
 * "Avatars — square r8 (32) / circle (18)". It is a size of its own
 * rather than a new number on `md`, because `md` (26) also draws the
 * account-menu chip and the comment-thread chip, and neither of those is
 * this decision: the menu's own size is 40 (§6 "header with a 40 avatar")
 * and the comment chip belongs to the Details pass. One call site, one
 * size, no ripple.
 */
export type AvatarSize = 'sm' | 'md' | 'header' | 'lg';
export type AvatarKind = 'human' | 'agent' | 'system';

export interface AvatarProps {
  username: string;
  /** Used as the colour seed when supplied; falls back to username. */
  userId?: string | null;
  size?: AvatarSize;
  kind?: AvatarKind;
  /**
   * Override the hover tooltip; defaults to "@username". Pass `null` to
   * emit NO `title` attribute at all — call sites that wrap the avatar
   * in an instant `SkeinTooltip` (header account button, sk-285.1.18.5)
   * must suppress it, or the browser's own delayed tooltip fires on top
   * of the instant one, which the tooltip rule (open instantly, no delay) forbids.
   */
  title?: string | null;
  className?: string;
  style?: CSSProperties;
}

const SIZES: Record<AvatarSize, number> = { sm: 18, md: 26, header: 32, lg: 40 };

/**
 * Corner radius per size (sk-285.7.8, H15).
 *
 * `header` (H15) and now `lg` (AM1) carry the design language's r8; the
 * map exists so that adopting the rest is an edit to a table rather than
 * a new prop: §8 draws every square avatar at r8 and the 18px one as a
 * circle.
 *
 * `lg` is the account-menu chip and nothing else (§6 "header with an avatar 40"),
 * so moving its radius ripples nowhere. The artboard writes
 * `border-radius:10px` on that one chip — a number that exists nowhere
 * else in fable: §5's radius scale is 6 / 8 / 12 / 999 and §8 says every
 * square avatar is r8. Two avatars a hand's width apart at 8 and 10
 * would be the visible half of that contradiction, so the chip takes the
 * scale's r8, the same as the rail chip above it.
 *
 * `sm` is the circle, as of the Details pass (sk-285.7 fidelity D5). The
 * note that stood here reserved this cell for exactly that pass — «the
 * 160 `sm` call sites … are the Details / Tasks / Activity passes' to
 * move, not this one's» — and D5 is the finding that needed it: the
 * author chip of `Sk Details.dc.html` is the only avatar any artboard
 * draws at this size, and it draws `border-radius:50%`. No artboard
 * anywhere shows an 18px SQUARE, so the shape moves for every `sm` call
 * site at once rather than for the one chip, which is what keeps a
 * single size from meaning two shapes.
 *
 * `md` (26) is still a literal 0 and still honest: it is the comment
 * thread's and the account menu's size, §8 gives the squares r8, and
 * neither of those chips is this pass.
 */
const RADII: Record<AvatarSize, string> = {
  sm: 'var(--radius-pill)',
  md: '0',
  header: 'var(--radius-card)',
  lg: 'var(--radius-card)',
};

// Fixed ember-tinted palette (Q4). Eight shades chosen to all maintain
// contrast against the page ground and read distinctly from the ring
// around them. The prose named `--skein-bg` / `--skein-accent` when the
// chip was drawn on the CRT skin; the ring is `--primary` and the agent
// badge stands on `--bg` since sk-521 — see the ring note below.
//
// sk-285.1.6 — AUDITED EXCEPTION to "no colour literal outside the token
// catalog". This is a per-entity identity palette: the shade is hashed
// from the username, so a given user must keep the same chip regardless
// of which skin is active. Per-entity styling is out of the MCP theming
// scope by definition. Recorded in the header of lib/themeTokens.ts.
const PALETTE = [
  '#7a3a18',
  '#a44a1a',
  '#5e2a10',
  '#8d4520',
  '#c25e25',
  '#6b341a',
  '#9a4f24',
  '#763914',
];

/**
 * sk-371 — the initials' ink is chosen PER GROUND, and is a literal for
 * the same reason the ground is.
 *
 * ── What was wrong ───────────────────────────────────────────────────
 *
 * The initials were `var(--skein-fg)`, carried over from the
 * pre-redesign code unchanged. Two separate faults, both measured on a
 * live Chromium (both built-in themes, `http://localhost:5173`):
 *
 *   · `#e8d5b7` on the eight shades reads 5.98 / 4.10 / 8.06 / 4.87 /
 *     2.97 / 6.87 / 4.16 / 6.19 — three of eight under AA's 4.5:1. The
 *     rendered header chip (`admin` → `#a44a1a`, 32px, 12/600) measures
 *     4.10:1 in BOTH themes, because both sides of the pair are literals
 *     and neither moves with the theme.
 *   · `--skein-fg` is REBOUND inside `.col-details` (index.css) to
 *     `--ink`. An avatar rendered there therefore takes `#1c1917` in the
 *     light theme, whose worst shade is 1.51:1 — a latent case far worse
 *     than the one originally reported, and one that appears the moment
 *     a chip is placed in Details rather than the shell.
 *
 * ── Why not a dictionary role ────────────────────────────────────────
 *
 * Because the GROUND does not move with the theme: PALETTE is a
 * per-entity identity palette (audited exception 3 in `lib/themeTokens.ts`
 * — a user must keep the same chip under any skin). Pairing a fixed
 * ground with a theme-varying ink is precisely the bug above: measured,
 * `--on-primary` is `#ffffff` in light and `#2a0f0f` in dark, which
 * collapses this chip to 1.55:1 in the dark theme. The ink belongs to
 * the same audited exception as the ground it sits on.
 *
 * ── Why per-ground, and not one better literal ────────────────────────
 *
 * No single ink can clear 4.5:1 on all eight shades, and that is a
 * property of the palette rather than a matter of taste. Contrast
 * against a fixed ground is monotonic in the ink's luminance, so the
 * best any one ink can do is one of the two extremes; swept across the
 * whole greyscale axis the optimum is pure white at **4.27:1**, held
 * down by `#c25e25`. White is simultaneously too light for nothing and
 * too dark for nothing else — `#5e2a10` gives black only 1.81:1.
 *
 * So the ink is picked per ground, as whichever extreme that ground
 * carries better. Exactly one shade (`#c25e25`) takes the dark ink, and
 * so does the `system` ground `--skein-fg-muted` (`#8a7a65`, which the
 * old ink read at 2.90:1). Resulting ratios, all ≥ 4.5, identical in
 * both themes because every pair is literal-on-literal:
 *
 *   #7a3a18 8.59   #a44a1a 5.88   #5e2a10 11.57  #8d4520 6.99
 *   #c25e25 4.92*  #6b341a 9.85   #9a4f24 5.97   #763914 8.88
 *   #8a7a65 5.05*  (system)                        * dark ink
 *
 * The GROUNDS are unchanged byte for byte: every user keeps the chip
 * colour they had. Geometry is untouched (32/r8 header, 40 menu).
 * The table above was measured at sk-285.7.
 *
 * ── Still open, and NOT decided here ─────────────────────────────────
 *
 * Whether the chip counts as decorative (`aria-hidden`, always paired
 * with a textual `@username`) and so falls outside 1.4.3 at all is a
 * question for a person — it is an open
 * visual-review item. It does not gate this
 * change: clearing the threshold is correct under either answer, and
 * neither answer excuses an ink that reads 1.51:1 in Details.
 */
const INK_LIGHT = '#ffffff';
const INK_DARK = '#000000';

/**
 * Ground for `kind: 'system'`, previously `var(--skein-fg-muted)`.
 *
 * Written as the literal that role resolves to, and for the SAME reason
 * the ink is a literal: this ground has to pair with a fixed ink, and a
 * ground that moves while the ink stands still is the defect above. The
 * value is byte-identical to what `--skein-fg-muted` resolves to in both
 * themes (measured: `#8a7a65` in each), so nothing changes on screen —
 * what changes is that the pair is now decidable. Under the old ink it
 * read 2.90:1; with `inkForGround` it reads 5.05:1.
 */
const SYSTEM_GROUND = '#8a7a65';

/** sRGB relative luminance (WCAG 2.x) of a `#rrggbb` literal. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * The higher-contrast of the two extremes for a given ground. Both
 * candidates are computed rather than compared against a threshold: a
 * threshold would need a fallback for grounds that clear neither, and
 * "whichever is better" has no such case.
 */
export function inkForGround(background: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) return INK_LIGHT;
  const l = luminance(background);
  const onLight = (l + 0.05) / 0.05; // contrast against INK_DARK
  const onWhite = 1.05 / (l + 0.05); // contrast against INK_LIGHT
  return onWhite >= onLight ? INK_LIGHT : INK_DARK;
}

/**
 * djb2 hash, returning a non-negative integer. Cheap, stable across
 * sessions (same username + userId always lands on the same colour),
 * and good enough for the 8-bucket palette.
 */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    // Force 32-bit semantics — JS numbers grow past int32 otherwise.
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Take 1-2 alphanumeric chars from the username, uppercased. Strips a
 * leading "@" if the caller passes a mention-style string. Falls back
 * to "?" when the input is empty or punctuation-only.
 */
function initials(username: string): string {
  const clean = username.replace(/^@/, '').replace(/[^a-zA-Z0-9]/g, '');
  if (clean.length === 0) return '?';
  return clean.slice(0, 2).toUpperCase();
}

function fontSizeFor(px: number): number {
  if (px <= 18) return 9;
  if (px <= 26) return 11;
  // sk-285.7.8 — the 32px chip's initials are 12px: the artboard writes
  // `font-size:12px` on the header avatar, and §2's caption step is 12.
  // The three steps around it are unchanged (18→9, 26→11, 40→16).
  if (px <= 32) return 12;
  return 16;
}

/**
 * sk-521 — the ring and the agent badge read ROLES, not the bridge.
 *
 * They were `var(--skein-accent)` and `var(--skein-bg)`, and this is the
 * one component of the four sk-521 measured where the two declarations of
 * the bridge really did paint different things. The avatar renders in the
 * header (`HeaderBar`) and in the filter panel (`TaskFilters`), both
 * OUTSIDE `.col-details`, and in the people chain (`PeopleChain`) INSIDE
 * it — so the same user wore an ember `#ff7a3d` ring on a near-black
 * `#1a1410` badge in the header and a `--primary` ring on `--bg` two
 * columns over, in the same page and the same theme.
 *
 * `--primary` is the text-capable brand grade (sk-285.7), which is why
 * `.col-details` already mapped the ring to it and said so; the ring is
 * the one non-text consumer of that mapping and carries the text grade
 * comfortably in both bases. The ink INSIDE the disc is a separate
 * decision and stays a literal — see `inkForGround` and sk-371: it has to
 * pair with a ground that is itself a literal.
 */
export function Avatar({
  username,
  userId,
  size = 'sm',
  kind = 'human',
  title,
  className,
  style,
}: AvatarProps) {
  const px = SIZES[size];
  const seed = userId || username;
  const bgColor = kind === 'system' ? SYSTEM_GROUND : PALETTE[hash(seed) % PALETTE.length];
  const fontSize = fontSizeFor(px);

  return (
    <span
      className={className}
      title={title === null ? undefined : title || `@${username.replace(/^@/, '')}`}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: RADII[size],
        background: bgColor,
        color: inkForGround(bgColor),
        border: '1px solid var(--primary)',
        fontFamily: 'var(--font-mono)',
        fontSize,
        fontWeight: 600,
        userSelect: 'none',
        position: 'relative',
        flexShrink: 0,
        lineHeight: 1,
        ...style,
      }}
    >
      {initials(username)}
      {kind === 'agent' ? (
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            fontSize: Math.max(8, Math.floor(fontSize * 0.7)),
            background: 'var(--bg)',
            color: 'var(--primary)',
            padding: '0 2px',
            lineHeight: 1,
            border: '1px solid var(--primary)',
          }}
        >
          {'>'}
        </span>
      ) : null}
    </span>
  );
}
