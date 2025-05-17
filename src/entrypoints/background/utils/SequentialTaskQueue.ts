import { logInfo } from "./log";

export class SequentialTaskQueue {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  private queue: (() => Promise<any>)[] = [];
  private isTaskRunning = false;

  public async addTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => task().then(resolve, reject));
      this.processQueue();
    });
  }

  private async processQueue() {
    if (!this.isTaskRunning && this.queue.length > 0) {
      this.isTaskRunning = true;
      const task = this.queue.shift();

      try {
        await task?.();
      } catch (e) {
        logInfo(`Failed to execute task: ${e}`);
      } finally {
        this.isTaskRunning = false;
        this.processQueue();
      }
    }
  }
}
