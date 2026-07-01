/* eslint-env jest, node */

const { mapWithConcurrency } = require("../../../utils/folderUpload/uploadQueue");

describe("uploadQueue", () => {
  it("processes items with limited concurrency", async () => {
    const active = { current: 0, max: 0 };
    const order = [];

    await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        active.current += 1;
        active.max = Math.max(active.max, active.current);
        order.push(item);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active.current -= 1;
        return item * 2;
      },
      { concurrency: 2 }
    );

    expect(active.max).toBeLessThanOrEqual(2);
    expect(order).toHaveLength(6);
  });

  it("reports progress callbacks", async () => {
    const progress = [];

    await mapWithConcurrency(
      ["a", "b", "c"],
      async (item) => item.toUpperCase(),
      {
        concurrency: 2,
        onProgress: (completed, total) => progress.push({ completed, total }),
      }
    );

    expect(progress.length).toBe(3);
    expect(progress[progress.length - 1]).toEqual({ completed: 3, total: 3 });
  });
});
