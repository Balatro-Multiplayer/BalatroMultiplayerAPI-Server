declare module 'bun:test' {
  type BunLifecycleFn = (
    name: string,
    callback: () => void | Promise<void>
  ) => void

  type ExpectMatcher = {
    toEqual(expected: unknown): void
    toBe(expected: unknown): void
    toBeNull(): void
    toContain(expected: unknown): void
    toHaveLength(expected: number): void
  }

  export const describe: BunLifecycleFn
  export const expect: (value: unknown) => ExpectMatcher
  export const test: BunLifecycleFn
}
