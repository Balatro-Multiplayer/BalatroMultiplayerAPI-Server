const CHECK_TIMEOUT_MS = 15_000

// Whether a pinned download URL still serves a file: 'ok' on a 2xx,
// 'unavailable' on a 404/410 (the version or asset is really gone), null when
// the answer is unknown (network error, 5xx, rate limit) so a transient
// outage never flips a pin's status. HEAD first; hosts that refuse HEAD get a
// one-byte ranged GET instead.
export async function checkDownloadAvailable(
	url: string,
): Promise<'ok' | 'unavailable' | null> {
	const attempt = async (init: RequestInit) => {
		try {
			return await fetch(url, {
				...init,
				redirect: 'follow',
				signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
			})
		} catch {
			return null
		}
	}

	let res = await attempt({ method: 'HEAD' })
	if (res && (res.status === 405 || res.status === 501)) {
		res = await attempt({ method: 'GET', headers: { Range: 'bytes=0-0' } })
		await res?.body?.cancel()
	}
	if (!res) return null
	if (res.ok) return 'ok'
	if (res.status === 404 || res.status === 410) return 'unavailable'
	return null
}
