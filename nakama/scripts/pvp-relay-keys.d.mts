export interface Miss {
	line: number
	text: string
}
export function scanLua(lua: string): { keys: string[]; misses: Miss[] }
export function extractPvpKeys(lua: string): string[]
export function pvpKeysInMod(modDir: string): {
	keys: string[]
	misses: (Miss & { file: string })[]
}
