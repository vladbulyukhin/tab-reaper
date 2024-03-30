export class CircularQueue<T> {
  private elements: T[];
  private capacity: number;
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("Capacity must be greater than 0");
    }
    this.capacity = capacity;
    this.elements = new Array(capacity);
  }

  public static fromJSON<T>(json: string): CircularQueue<T> {
    const obj = JSON.parse(json);
    const { elements, capacity } = obj;
    const queue = new CircularQueue<T>(capacity);

    for (const element of elements) {
      queue.enqueue(element);
    }

    return queue;
  }

  public toJSON(): string {
    return JSON.stringify({
      capacity: this.capacity,
      elements: this.toArray(),
    });
  }

  public enqueue(element: T): void {
    if (this.isFull()) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    this.elements[this.tail] = element;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
  }

  public dequeue(): T | undefined {
    if (this.isEmpty()) {
      return undefined;
    }
    const element = this.elements[this.head];
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return element;
  }

  public peek(): T | undefined {
    if (this.isEmpty()) {
      return undefined;
    }
    return this.elements[this.head];
  }

  public isEmpty(): boolean {
    return this.count === 0;
  }

  public isFull(): boolean {
    return this.count === this.capacity;
  }

  public size(): number {
    return this.count;
  }

  public toArray(): T[] {
    const result = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.elements[(this.head + i) % this.capacity];
    }
    return result;
  }
}
