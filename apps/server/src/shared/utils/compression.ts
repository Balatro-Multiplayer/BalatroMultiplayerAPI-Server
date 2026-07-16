import { gunzipSync, gzipSync } from 'node:zlib'

export function compressToBase64(data: string): string {
	return gzipSync(Buffer.from(data, 'utf8')).toString('base64')
}

export function decompressFromBase64(data: string): string {
	return gunzipSync(Buffer.from(data, 'base64')).toString('utf8')
}
