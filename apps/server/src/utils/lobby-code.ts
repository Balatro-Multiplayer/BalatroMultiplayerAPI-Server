const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'

export function generateLobbyCode(length = 6): string {
	let result = ''
	for (let i = 0; i < length; i++) {
		result += CHARS.charAt(Math.floor(Math.random() * CHARS.length))
	}
	return result
}
