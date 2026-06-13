export default defineNuxtConfig({
	devtools: { enabled: false },
	vite: {
		server: {
			allowedHosts: true,
		},
	},
	modules: ['@pinia/nuxt'],
	css: ['~/assets/css/tokens.css'],
	nitro: {
		devProxy: {
			'/api': { target: 'http://localhost:8788/api', changeOrigin: true, prependPath: false },
		},
	},
	runtimeConfig: {
		public: {
			apiBase: '/api',
		},
	},
	app: {
		head: {
			title: 'Balatro Multiplayer',
			meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/logo.png' }],
		},
	},
	compatibilityDate: '2025-01-01',
})
