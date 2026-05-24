import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/tests/e2e/**/*.test.ts'],
		globalSetup: ['src/tests/e2e/globalSetup.ts'],
		testTimeout: 30_000,
		hookTimeout: 60_000,
		environment: 'node',
		fileParallelism: false,
	},
})
