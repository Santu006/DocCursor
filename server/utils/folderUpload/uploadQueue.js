/**
 * Run async tasks with a fixed concurrency limit.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<void>} worker
 * @param {object} [options]
 * @param {number} [options.concurrency=4]
 * @param {(completed: number, total: number, item: T) => void} [options.onProgress]
 * @returns {Promise<void>}
 */
async function runWithConcurrency(items = [], worker, options = {}) {
  const concurrency = Math.max(1, options.concurrency || 4);
  const total = items.length;
  let index = 0;
  let completed = 0;

  async function runNext() {
    while (index < total) {
      const currentIndex = index++;
      const item = items[currentIndex];
      await worker(item, currentIndex);
      completed += 1;
      options.onProgress?.(completed, total, item);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, total) }, () =>
    runNext()
  );
  await Promise.all(runners);
}

/**
 * Map items in parallel with concurrency and collect per-item results.
 *
 * @template T,R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @param {object} [options]
 * @param {number} [options.concurrency=4]
 * @param {(completed: number, total: number, item: T) => void} [options.onProgress]
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items = [], mapper, options = {}) {
  const results = new Array(items.length);
  await runWithConcurrency(
    items,
    async (item, index) => {
      results[index] = await mapper(item, index);
    },
    options
  );
  return results;
}

module.exports = {
  mapWithConcurrency,
  runWithConcurrency,
};
