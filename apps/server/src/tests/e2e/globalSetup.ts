import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const execAsync = promisify(exec)

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const COMPOSE_FILE = path.join(SERVER_DIR, 'docker-compose.e2e.yml')

export const E2E_API_URL = process.env.E2E_API_URL ?? 'http://localhost:18788'
export const E2E_MQTT_URL = process.env.E2E_MQTT_URL ?? 'mqtt://localhost:11883'
export const E2E_DB_URL = process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@localhost:15432/bmp_e2e'

// Runs a SQL query directly against the E2E database (useful for seeding).
export async function seedDb(sql: string, values?: unknown[]): Promise<void> {
	const client = new pg.Client({ connectionString: E2E_DB_URL })
	await client.connect()
	try {
		await client.query(sql, values)
	} finally {
		await client.end()
	}
}

async function waitForHealth(url: string, timeoutMs = 90_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	let last: string | null = null
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url)
			if (res.ok) return
			last = `HTTP ${res.status}`
		} catch (err) {
			last = String(err)
		}
		await new Promise((r) => setTimeout(r, 2_000))
	}
	throw new Error(`E2E stack not healthy after ${timeoutMs}ms: ${last}`)
}

export async function setup(): Promise<void> {
	// If the stack is already up (local dev iteration), skip startup
	try {
		await waitForHealth(`${E2E_API_URL}/health`, 3_000)
		console.log('[e2e] Stack already running — skipping docker compose up')
		return
	} catch {
		// not running, fall through to start it
	}

	console.log('[e2e] Starting Docker stack...')
	await execAsync(`docker compose -f "${COMPOSE_FILE}" up -d`, { cwd: SERVER_DIR })

	console.log('[e2e] Waiting for API health...')
	await waitForHealth(`${E2E_API_URL}/health`)
	console.log('[e2e] Stack ready.')
}

export async function teardown(): Promise<void> {
	if (process.env.E2E_KEEP_STACK === '1') {
		console.log('[e2e] E2E_KEEP_STACK=1 — leaving Docker stack running')
		return
	}
	console.log('[e2e] Tearing down Docker stack...')
	await execAsync(`docker compose -f "${COMPOSE_FILE}" down -v`, { cwd: SERVER_DIR })
}
