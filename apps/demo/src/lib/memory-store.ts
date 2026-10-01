import { MemoryStore } from "@beezping/adapter-memory";
import { seedDemoStore } from "./seed";

const RESET_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Singleton — survives Next.js hot reloads in dev
const g = globalThis as typeof globalThis & { __beezpingStore?: MemoryStore };
if (!g.__beezpingStore) {
  const store = new MemoryStore();
  g.__beezpingStore = store;
  void seedDemoStore(store);
  setInterval(() => {
    store.clear();
    void seedDemoStore(store);
  }, RESET_INTERVAL_MS);
}

export const memoryStore = g.__beezpingStore;
