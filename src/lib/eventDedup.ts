/**
 * Bounded FIFO event deduplicator keyed by event id.
 *
 * Why this exists: the skein-api outbox dispatcher is at-least-once. If
 * the process crashes between `nc.Publish` and `tx.Commit`, the same
 * events row is republished on the next tick — the SignalR client sees
 * the same envelope twice, and naive invalidation runs the cache delta
 * twice. Dedup by envelope.id (BIGSERIAL, globally unique) makes the
 * client side idempotent without coordinating with the server.
 *
 * Capacity: 1024 entries by default. The dispatcher commits in small
 * transactional batches so realistic re-deliveries arrive within a few
 * seconds of the original — far inside any reasonable buffer. We do not
 * use a TTL: BIGSERIAL ids are monotonically increasing, so the FIFO
 * order is also chronological order, and "evict oldest" matches "evict
 * most stale".
 *
 * One per TAB (sk-622.21 T044, US-14, R6): `LiveEventsProvider` keeps it
 * across reconnects, so an envelope re-delivered after a reconnect is
 * still a repeat. Events missed during the gap are not replayed; the
 * reconnect (or a `resync` frame) re-reads the tab's active data instead.
 */
export class EventDedup {
  /** Insertion-ordered map. Map iteration is FIFO since ES2015. */
  private readonly seen: Map<number, true> = new Map();
  private readonly maxSize: number;

  /**
   * @param maxSize maximum number of ids retained. Defaults to 1024 —
   *  ample for the realistic dispatcher re-delivery window.
   */
  constructor(maxSize = 1024) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(`EventDedup: maxSize must be a positive integer, got ${maxSize}`);
    }
    this.maxSize = maxSize;
  }

  /** True iff `id` has been observed via {@link add} since the last eviction. */
  has(id: number): boolean {
    return this.seen.has(id);
  }

  /**
   * Record `id` as seen. Idempotent — re-adding an existing id is a
   * no-op (does NOT refresh its position in the FIFO order). When the
   * map exceeds {@link maxSize} the oldest entry is evicted before the
   * insert so size stays bounded.
   */
  add(id: number): void {
    if (this.seen.has(id)) {
      // Idempotent: don't bump the position. Re-bumping would defeat the
      // FIFO semantics — newest seen would always evict before oldest.
      return;
    }
    if (this.seen.size >= this.maxSize) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    this.seen.set(id, true);
  }

  /** Current entry count. Test/diagnostic helper. */
  size(): number {
    return this.seen.size;
  }
}
