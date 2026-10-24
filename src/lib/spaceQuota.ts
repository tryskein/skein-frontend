/**
 * sk-674.18 T057 — the quota and limit labels of spaces (screens, "Quotas and
 * limits — one label per number", K3): seats, projects, files. One
 * label for one number everywhere it is shown — the «Spaces» tab, the
 * space settings, the invitation form. A limit that is not set has no
 * line (`null` here). People, spaces, projects and bytes — not issues: the
 * lenses and `outboxMode` do not apply.
 */
import type { TFunction } from 'i18next';
import type { MySpace } from '../api/spaces';

/** Seats taken: members plus pending invitations (they occupy a seat, plan 6.2). */
export function seatsTaken(space: Pick<MySpace, 'memberCount' | 'pendingInvitations'>): number {
  return space.memberCount + space.pendingInvitations;
}

/** No seat is left (pending invitations counted); false without a limit. */
export function noSeatsLeft(
  space: Pick<MySpace, 'memberCount' | 'pendingInvitations' | 'memberLimit'>,
): boolean {
  return space.memberLimit !== null && seatsTaken(space) >= space.memberLimit;
}

/**
 * "Seats taken: 7 of 25 (2 of them invitations)" — without the brackets when
 * nothing is pending; null without a limit (the common space, or
 * `SKEIN_SPACE_MEMBER_LIMIT` unset).
 */
export function seatsLabel(
  t: TFunction,
  space: Pick<MySpace, 'memberCount' | 'pendingInvitations' | 'memberLimit'>,
): string | null {
  if (space.memberLimit === null) return null;
  const params = { used: seatsTaken(space), limit: space.memberLimit };
  return space.pendingInvitations > 0
    ? t('spaces:quota.seatsWithInvitations', { ...params, count: space.pendingInvitations })
    : t('spaces:quota.seats', params);
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/**
 * "1.2 of 5 GB" in two halves: both numbers in the unit of the quota, the
 * unit written once, in the interface language — `used` bare, `quota` with
 * its unit ("0.4" / "1 GB"; the Russian locale uses a decimal comma). Binary units, as attachments
 * count them.
 */
export function bytesPair(used: number, quota: number, language: string): { used: string; quota: string } {
  const [divisor, unit] =
    quota >= GIB ? [GIB, 'gigabyte'] : quota >= MIB ? [MIB, 'megabyte'] : [1024, 'kilobyte'];
  return {
    used: new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(used / divisor),
    quota: new Intl.NumberFormat(language, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(quota / divisor),
  };
}

/** A size in the interface language and the largest binary unit that fits: "1.2 GB", "340 MB". */
export function formatBytes(bytes: number, language: string): string {
  const [divisor, unit] =
    bytes >= GIB ? [GIB, 'gigabyte'] : bytes >= MIB ? [MIB, 'megabyte'] : bytes >= 1024 ? [1024, 'kilobyte'] : [1, 'byte'];
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / divisor);
}

/**
 * The quota lines of a space, only those that are set, in screen order
 * (2.3): projects, then files. `personal` — the short labels of the
 * "Personal" row on the «Spaces» tab ("Projects: 3 of 10 · Files: 0.4 of 1
 * GB"); otherwise the settings labels. The files line says the upload is
 * stopped once the soft quota is crossed (plan 4.5).
 */
export function quotaLines(
  t: TFunction,
  space: Pick<MySpace, 'projectCount' | 'projectQuota' | 'storageUsedBytes' | 'storageQuotaBytes'>,
  language: string,
  personal: boolean,
): string[] {
  const lines: string[] = [];
  if (space.projectQuota !== null) {
    lines.push(
      t(personal ? 'spaces:quota.personalProjects' : 'spaces:quota.projects', {
        count: space.projectCount,
        quota: space.projectQuota,
      }),
    );
  }
  if (space.storageQuotaBytes !== null) {
    const pair = bytesPair(space.storageUsedBytes, space.storageQuotaBytes, language);
    const line = t(personal ? 'spaces:quota.personalStorage' : 'spaces:quota.storage', pair);
    lines.push(
      space.storageUsedBytes >= space.storageQuotaBytes
        ? `${line}${t('spaces:quota.storageStopped')}`
        : line,
    );
  }
  return lines;
}
