// Test-only helper. There's no jsdom in this project (tests run in Node)
// and localStorage is only ever used from browser/Tizen code, so it isn't
// global here — this fakes just enough of the Storage contract for
// localStore.ts/session.ts tests: getItem/setItem/removeItem, plus stored
// keys showing up as own enumerable properties (which clearAllAppStorage's
// Object.keys(localStorage) relies on, same as the real Storage object).
export function makeFakeLocalStorage(): Storage {
  const storage: Record<string, string> = {}
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => (key in storage ? storage[key] : null), configurable: true },
    setItem: {
      value: (key: string, value: string) => {
        storage[key] = value
      },
      configurable: true,
    },
    removeItem: {
      value: (key: string) => {
        delete storage[key]
      },
      configurable: true,
    },
    clear: {
      value: () => {
        for (const key of Object.keys(storage)) delete storage[key]
      },
      configurable: true,
    },
  })
  return storage as unknown as Storage
}
