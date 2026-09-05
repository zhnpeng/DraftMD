export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiting: Array<(value: IteratorResult<T>) => void> = []
  private closed = false
  push(value: T): void {
    const waiter = this.waiting.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }
  close(): void {
    this.closed = true
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiting.push(resolve))
      },
    }
  }
}
