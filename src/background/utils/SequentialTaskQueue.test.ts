import { beforeEach, describe, expect, it } from "vitest";
import { SequentialTaskQueue } from "./SequentialTaskQueue";

describe("SequentialTaskQueue", () => {
  let queue: SequentialTaskQueue;

  beforeEach(() => {
    queue = new SequentialTaskQueue();
  });

  it("should execute tasks in the order they are added", async () => {
    const output: number[] = [];

    await Promise.all([
      queue.addTask(() =>
        Promise.resolve().then(() => {
          output.push(1);
        }),
      ),
      queue.addTask(() =>
        Promise.resolve().then(() => {
          output.push(2);
        }),
      ),
      queue.addTask(() =>
        Promise.resolve().then(() => {
          output.push(3);
        }),
      ),
    ]);

    expect(output).toEqual([1, 2, 3]);
  });

  it("should handle errors without stopping the queue", async () => {
    const output: string[] = [];

    await queue
      .addTask(() => Promise.reject(new Error("Failed")))
      .catch(() => output.push("Failed"));
    await queue.addTask(() =>
      Promise.resolve().then(() => void output.push("Success")),
    );

    expect(output).toEqual(["Failed", "Success"]);
  });

  it("should handle tasks added simultaneously correctly", async () => {
    const output: number[] = [];

    queue.addTask(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            output.push(1);
            resolve(1);
          }, 50),
        ),
    );
    queue.addTask(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            output.push(2);
            resolve(2);
          }, 30),
        ),
    );
    queue.addTask(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            output.push(3);
            resolve(3);
          }, 10),
        ),
    );

    // Wait for all tasks to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(output).toEqual([1, 2, 3]);
  });
});
