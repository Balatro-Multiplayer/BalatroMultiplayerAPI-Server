export default defineEventHandler((event) => {
	const target = process.env.API_PROXY_TARGET ?? 'http://localhost:8788'
	return proxyRequest(event, `${target}${event.path}`, {
		fetchOptions: { redirect: 'manual' },
	})
})
