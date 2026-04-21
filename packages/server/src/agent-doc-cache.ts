/**
 * AgentDocCache — TTL + LRU cache for resolved agent public keys.
 *
 * Without a cache, every `register` / `authorize` call fetches the agent's
 * `/.well-known/agent.json` live. That turns any verifier into a DoS
 * amplifier on the agent's host. This cache keys by `(agent_id, kid)` so
 * key rotation (new `kid`) naturally invalidates, while the common steady
 * state hits the cache.
 *
 * Only *successful* resolutions are cached — failures are never cached so
 * a transient upstream outage can't poison verification.
 */

export interface CachedKeyResolver<T> {
  get(agentId: string, kid: string): Promise<T | undefined>;
  set(agentId: string, kid: string, value: T): Promise<void>;
  delete(agentId: string, kid: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Coalesced load: on cache miss, invoke `loader` and cache the result, but
   * if a concurrent caller is already loading the same key, await the
   * in-flight promise instead of re-invoking `loader`. This is what prevents
   * a burst of concurrent verifications from stampeding the agent's host.
   *
   * Failed loads are NOT cached — the next caller retries.
   */
  getOrLoad(agentId: string, kid: string, loader: () => Promise<T>): Promise<T>;
  /** Current number of cached entries — useful for tests and metrics. */
  size(): number;
}

export interface AgentDocCacheConfig {
  ttlMs?: number;
  maxEntries?: number;
  /** Override for deterministic testing. Defaults to Date.now. */
  now?: () => number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory TTL+LRU cache. Defaults: 5 min TTL, 1000 entries.
 *
 * `Map` in Node preserves insertion order; we exploit that for LRU by
 * deleting+re-inserting on read to move entries to the tail. The head is
 * the LRU; when we exceed `maxEntries` we evict the head.
 */
export class InMemoryAgentDocCache<T = unknown> implements CachedKeyResolver<T> {
  private entries = new Map<string, Entry<T>>();
  private inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(config: AgentDocCacheConfig = {}) {
    this.ttlMs = config.ttlMs ?? 5 * 60_000;
    this.maxEntries = config.maxEntries ?? 1000;
    this.now = config.now ?? Date.now;
  }

  private static key(agentId: string, kid: string): string {
    return `${agentId}\u0000${kid}`;
  }

  async get(agentId: string, kid: string): Promise<T | undefined> {
    const key = InMemoryAgentDocCache.key(agentId, kid);
    const hit = this.entries.get(key);
    if (!hit) return undefined;

    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  async set(agentId: string, kid: string, value: T): Promise<void> {
    const key = InMemoryAgentDocCache.key(agentId, kid);
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async delete(agentId: string, kid: string): Promise<void> {
    this.entries.delete(InMemoryAgentDocCache.key(agentId, kid));
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.inFlight.clear();
  }

  size(): number {
    return this.entries.size;
  }

  async getOrLoad(agentId: string, kid: string, loader: () => Promise<T>): Promise<T> {
    const key = InMemoryAgentDocCache.key(agentId, kid);

    const cached = await this.get(agentId, kid);
    if (cached !== undefined) return cached;

    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const value = await loader();
        await this.set(agentId, kid, value);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}
