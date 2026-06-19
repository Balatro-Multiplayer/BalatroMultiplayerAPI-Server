declare module 'bun:test' {
  type BunLifecycleFn = (
    name: string,
    callback: () => void | Promise<void>
  ) => void

  type ExpectMatcher = {
    toEqual(expected: unknown): void
  }

  export const describe: BunLifecycleFn
  export const expect: (value: unknown) => ExpectMatcher
  export const test: BunLifecycleFn
}
