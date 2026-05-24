import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: {
			// Allow imports from sibling packages (e.g. the server's schema)
			allow: ['..'],
		},
	},
})
