import { describe, expect, it } from "vitest";
import { CircularQueue } from "./CircularQueue";

describe("CircularQueue", () => {
  it("should throw an error if initialized with zero or negative capacity", () => {
    expect(() => new CircularQueue(0)).toThrow(
      "Capacity must be greater than 0",
    );
    expect(() => new CircularQueue(-1)).toThrow(
      "Capacity must be greater than 0",
    );
  });

  it("should initialize an empty queue", () => {
    const queue = new CircularQueue<number>(3);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it("should enqueue elements", () => {
    const queue = new CircularQueue<string>(2);
    queue.enqueue("a");
    expect(queue.isEmpty()).toBe(false);
    expect(queue.size()).toBe(1);
    expect(queue.peek()).toBe("a");
    queue.enqueue("b");
    expect(queue.size()).toBe(2);
    expect(queue.isFull()).toBe(true);
  });

  it("should wrap around when enqueueing to a full queue", () => {
    const queue = new CircularQueue<number>(2);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3); // This should overwrite 1
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBe(3);
    expect(queue.isEmpty()).toBe(true);
  });

  it("should dequeue elements", () => {
    const queue = new CircularQueue<number>(3);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.dequeue();
    expect(queue.size()).toBe(1);
    expect(queue.peek()).toBe(2);
  });

  it("should return undefined when dequeueing from an empty queue", () => {
    const queue = new CircularQueue<number>(3);
    expect(queue.dequeue()).toBeUndefined();
  });

  it("should peek at the front element without removing it", () => {
    const queue = new CircularQueue<string>(2);
    queue.enqueue("hello");
    queue.enqueue("world");
    expect(queue.peek()).toBe("hello");
    queue.dequeue();
    expect(queue.peek()).toBe("world");
  });

  it("should accurately report when it is full", () => {
    const queue = new CircularQueue<number>(1);
    expect(queue.isFull()).toBe(false);
    queue.enqueue(1);
    expect(queue.isFull()).toBe(true);
  });

  it("should handle multiple enqueue and dequeue operations", () => {
    const queue = new CircularQueue<number>(3);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.dequeue();
    queue.enqueue(3);
    queue.enqueue(4);
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBe(3);
    expect(queue.size()).toBe(1);
    expect(queue.peek()).toBe(4);
    expect(queue.isFull()).toBe(false);
  });

  it("should return a valida JSON string of the queue when serialized", () => {
    const queue = new CircularQueue<number>(3);
    queue.enqueue(1);
    queue.enqueue(2);
    const jsonString = queue.toJSON();
    const expectedJson = JSON.stringify({
      capacity: 3,
      elements: [1, 2],
    });
    expect(jsonString).toBe(expectedJson);
  });

  it("should reconstruct the queue from a JSON string", () => {
    const json = JSON.stringify({
      capacity: 3,
      elements: [1, 2, 3],
    });
    const queue = CircularQueue.fromJSON<number>(json);
    expect(queue.size()).toBe(3);
    expect(queue.dequeue()).toBe(1);
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBe(3);
    expect(queue.isEmpty()).toBe(true);
  });

  it("should throw an error with invalid JSON format", () => {
    const invalidJson = '{"capacity": 3, "elems": [1, 2, 3]}'; // wrong keys
    expect(() => CircularQueue.fromJSON<number>(invalidJson)).toThrow();
  });
});
