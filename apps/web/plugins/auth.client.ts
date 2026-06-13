export default defineNuxtPlugin(async () => {
	const auth = useAuth()
	if (auth.getToken()) {
		await auth.fetchMe()
	}
})
