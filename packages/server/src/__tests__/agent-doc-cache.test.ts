import { describe, it, expect } from "vitest";
import { InMemoryAgentDocCache } from "../agent-doc-cache.js";

describe("InMemoryAgentDocCache", () => {
  it("MH-A5: expires entries after ttlMs", async () => {
    let t = 0;
    const cache = new InMemoryAgentDocCache<string>({ ttlMs: 1000, now: () => t });
    await cache.set("agent-1", "k1", "key-material");
    expect(await cache.get("agent-1", "k1")).toBe("key-material");

    t = 999;
    expect(await cache.get("agent-1", "k1")).toBe("key-material");

    t = 1001;
    expect(await cache.get("agent-1", "k1")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("MH-A6: evicts least-recently-used when over maxEntries", async () => {
    const cache = new InMemoryAgentDocCache<string>({ maxEntries: 3 });
    await cache.set("a1", "k", "1");
    await cache.set("a2", "k", "2");
    await cache.set("a3", "k", "3");
    await cache.get("a1", "k");
    await cache.get("a2", "k");
    await cache.set("a4", "k", "4");

    expect(await cache.get("a1", "k")).toBe("1");
    expect(await cache.get("a2", "k")).toBe("2");
    expect(await cache.get("a3", "k")).toBeUndefined();
    expect(await cache.get("a4", "k")).toBe("4");
    expect(cache.size()).toBe(3);
  });

  it("returns undefined on miss", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    expect(await cache.get("nope", "k")).toBeUndefined();
  });

  it("separates entries by agent_id and by kid", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    await cache.set("agent-1", "k1", "A");
    await cache.set("agent-1", "k2", "B");
    await cache.set("agent-2", "k1", "C");
    expect(await cache.get("agent-1", "k1")).toBe("A");
    expect(await cache.get("agent-1", "k2")).toBe("B");
    expect(await cache.get("agent-2", "k1")).toBe("C");
    expect(cache.size()).toBe(3);
  });

  it("clear() wipes every entry", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    await cache.set("a", "k", "v");
    await cache.clear();
    expect(cache.size()).toBe(0);
    expect(await cache.get("a", "k")).toBeUndefined();
  });

  it("delete() removes a single entry", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    await cache.set("a", "k", "v");
    await cache.delete("a", "k");
    expect(await cache.get("a", "k")).toBeUndefined();
  });

  it("getOrLoad coalesces concurrent misses into a single load", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    let loads = 0;
    const loader = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 20));
      return "value";
    };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => cache.getOrLoad("agent-1", "k1", loader)),
    );
    expect(loads).toBe(1);
    expect(results.every((v) => v === "value")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it("getOrLoad does NOT cache a failed load", async () => {
    const cache = new InMemoryAgentDocCache<string>();
    let loads = 0;
    const loader = async () => {
      loads++;
      if (loads === 1) throw new Error("transient");
      return "recovered";
    };
    await expect(cache.getOrLoad("a", "k", loader)).rejects.toThrow("transient");
    expect(cache.size()).toBe(0);
    const value = await cache.getOrLoad("a", "k", loader);
    expect(value).toBe("recovered");
    expect(loads).toBe(2);
  });

  it("re-setting the same key refreshes TTL and LRU position", async () => {
    let t = 0;
    const cache = new InMemoryAgentDocCache<string>({ ttlMs: 100, maxEntries: 2, now: () => t });
    await cache.set("a", "k", "v1");
    t = 90;
    await cache.set("a", "k", "v2");
    t = 150;
    expect(await cache.get("a", "k")).toBe("v2");
  });
});
