import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serialQueue'

// Manually-resolvable promise, so tests can assert nothing runs out of
// order without relying on real timers/sleeps.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createSerialQueue', () => {
  it('runs a single function and resolves with its result', async () => {
    const queue = createSerialQueue()
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('never runs a second function until the first has settled', async () => {
    const queue = createSerialQueue()
    const first = deferred<string>()
    let secondStarted = false

    const firstResult = queue.run(() => first.promise)
    const secondResult = queue.run(async () => {
      secondStarted = true
      return 'second'
    })

    // Give any stray microtasks a chance to run — the second fn must NOT
    // have started yet, since the first is still pending.
    await Promise.resolve()
    await Promise.resolve()
    expect(secondStarted).toBe(false)

    first.resolve('first')
    await expect(firstResult).resolves.toBe('first')
    await expect(secondResult).resolves.toBe('second')
    expect(secondStarted).toBe(true)
  })

  it('preserves call order and each call’s own result across several queued items', async () => {
    const queue = createSerialQueue()
    const order: number[] = []
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        queue.run(async () => {
          order.push(n)
          return n * 10
        }),
      ),
    )
    expect(order).toEqual([1, 2, 3])
    expect(results).toEqual([10, 20, 30])
  })

  it('a rejected call does not block subsequent queued calls', async () => {
    const queue = createSerialQueue()
    const failing = queue.run(() => Promise.reject(new Error('boom')))
    const succeeding = queue.run(() => Promise.resolve('still runs'))

    await expect(failing).rejects.toThrow('boom')
    await expect(succeeding).resolves.toBe('still runs')
  })

  it('a rejected call does not prevent later calls from resolving even when nothing awaits it immediately', async () => {
    const queue = createSerialQueue()
    // Deliberately not awaited/caught here (mirrors a caller that fires a
    // request and only cares about later ones) — the queue's internal
    // chain must still normalize the rejection itself (see serialQueue.ts's
    // own comment on `tail`) rather than depending on this call site to
    // handle it.
    void queue.run(() => Promise.reject(new Error('boom'))).catch(() => {})
    await expect(queue.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })
})
