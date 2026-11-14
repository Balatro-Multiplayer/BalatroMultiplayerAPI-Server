import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_PARAMS_BYTES } from './lobby/relay'

// The largest ACTION a client may send (params at relay.ts's cap) as the
// websocket message Nakama reads: the action JSON, base64'd into a
// match_data_send envelope.
function largestActionMessage() {
	const action = JSON.stringify({
		cid: 'c'.repeat(64),
		action: 'a'.repeat(64),
		to: 'server',
		params: 'x'.repeat(MAX_PARAMS_BYTES - 2),
	})
	return JSON.stringify({
		cid: '9999999999',
		match_data_send: {
			match_id: '00000000-0000-0000-0000-000000000000.bmp-nakama-node',
			op_code: '5',
			data: Buffer.from(action).toString('base64'),
		},
	}).length
}

function maxMessageSize(config: string) {
	const text = readFileSync(new URL(`../${config}`, import.meta.url), 'utf8')
	const match =
		/^socket:\n(?:[ \t]+.*\n|\n)*?[ \t]+max_message_size_bytes:\s*(\d+)/m.exec(
			text,
		)
	return match ? Number(match[1]) : 4096 // Nakama's default
}

describe('socket.max_message_size_bytes', () => {
	for (const config of ['local.yml', 'prod.yml']) {
		it(`${config} reads an ACTION at relay.ts's params cap`, () => {
			expect(maxMessageSize(config)).toBeGreaterThanOrEqual(
				largestActionMessage(),
			)
		})
	}
})

function inputQueueSize(config: string) {
	const text = readFileSync(new URL(`../${config}`, import.meta.url), 'utf8')
	const match = /^match:\n(?:[ \t]+.*\n|\n)*?[ \t]+input_queue_size:\s*(\d+)/m.exec(text)
	return match ? Number(match[1]) : 128 // Nakama's default
}

describe('match.input_queue_size', () => {
	for (const config of ['local.yml', 'prod.yml']) {
		it(`${config} holds a 261-event burst`, () => {
			expect(inputQueueSize(config)).toBeGreaterThanOrEqual(1024)
		})
	}
})

function maxRequestSize(config: string) {
	const text = readFileSync(new URL(`../${config}`, import.meta.url), 'utf8')
	const match =
		/^socket:\n(?:[ \t]+.*\n|\n)*?[ \t]+max_request_size_bytes:\s*(\d+)/m.exec(text)
	return match ? Number(match[1]) : 262144 // Nakama's default
}

describe('socket.max_request_size_bytes', () => {
	for (const config of ['local.yml', 'prod.yml']) {
		it(`${config} takes a Season replay fold call with thousands of players`, () => {
			expect(maxRequestSize(config)).toBeGreaterThanOrEqual(8 * 1024 * 1024)
		})
	}
})

function outgoingQueueSize(config: string) {
	const text = readFileSync(new URL(`../${config}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
	const match = /^socket:\n(?:[ \t]+.*\n|\n)*?[ \t]+outgoing_queue_size:\s*(\d+)/m.exec(text)
	return match ? Number(match[1]) : 64 // Nakama's default
}

describe('socket.outgoing_queue_size', () => {
	for (const config of ['local.yml', 'prod.yml']) {
		it(`${config} holds a spectated run's burst without closing the socket`, () => {
			expect(outgoingQueueSize(config)).toBeGreaterThanOrEqual(1024)
		})
	}
})
