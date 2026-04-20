// Detox runs tests via jest; declare the jest globals TypeScript needs.
declare function describe(name: string, fn: () => void): void
declare namespace describe {
  function skip(name: string, fn: () => void): void
  function only(name: string, fn: () => void): void
}
declare function it(name: string, fn: () => void | Promise<void>, timeout?: number): void
declare namespace it {
  function skip(name: string, fn: () => void | Promise<void>): void
  function only(name: string, fn: () => void | Promise<void>): void
}
declare const test: typeof it
declare function beforeAll(fn: () => void | Promise<void>, timeout?: number): void
declare function afterAll(fn: () => void | Promise<void>, timeout?: number): void
declare function beforeEach(fn: () => void | Promise<void>, timeout?: number): void
declare function afterEach(fn: () => void | Promise<void>, timeout?: number): void

interface JestMatchers {
  toBe(expected: unknown): void
  toBeLessThan(expected: number): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  not: JestMatchers
}

declare function expect(actual: unknown): JestMatchers
