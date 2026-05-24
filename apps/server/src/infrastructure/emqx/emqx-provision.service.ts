/**
 * Provisions EMQX webhook rule for client disconnect events via the REST API.
 *
 * EMQX 5.x does not load rule_engine/actions/connectors from cluster.hocon —
 * those must be created via the management API and are persisted in the data
 * volume.  This module ensures they exist every time the server starts.
 */

import { env } from '../../env.js'

const EMQX_API = env.EMQX_API_URL
const EMQX_USER = 'admin'
const EMQX_PASS = 'public'

const CONNECTOR_NAME = 'bmp_http_connector'
const ACTION_NAME = 'bmp_disconnect_hook'
const RULE_ID = 'bmp_client_disconnected'

async function getToken(): Promise<string> {
	const res = await fetch(`${EMQX_API}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: EMQX_USER, password: EMQX_PASS }),
	})
	if (!res.ok) throw new Error(`EMQX login failed: ${res.status}`)
	const data = (await res.json()) as { token: string }
	return data.token
}

async function api(
	token: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
	const res = await fetch(`${EMQX_API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = await res.json().catch(() => null)
	return { ok: res.ok, status: res.status, data }
}

export async function provisionEmqxWebhook(): Promise<void> {
	const token = await getToken()

	// 1. Connector
	const conn = await api(token, 'GET', `/connectors/http:${CONNECTOR_NAME}`)
	if (conn.status === 404) {
		const created = await api(token, 'POST', '/connectors', {
			type: 'http',
			name: CONNECTOR_NAME,
			url: 'http://api:8788',
			connect_timeout: '5s',
			pool_size: 4,
		})
		if (!created.ok)
			throw new Error(
				`Failed to create connector: ${JSON.stringify(created.data)}`,
			)
		console.log('[emqx-provision] Created HTTP connector')
	} else {
		console.log('[emqx-provision] HTTP connector already exists')
	}

	// 2. Action (webhook)
	const act = await api(token, 'GET', `/actions/http:${ACTION_NAME}`)
	if (act.status === 404) {
		const created = await api(token, 'POST', '/actions', {
			type: 'http',
			name: ACTION_NAME,
			connector: CONNECTOR_NAME,
			parameters: {
				path: '/emqx/webhook',
				method: 'post',
				body: '${.}',
				headers: { 'content-type': 'application/json' },
			},
			resource_opts: { request_ttl: '5s' },
		})
		if (!created.ok)
			throw new Error(
				`Failed to create action: ${JSON.stringify(created.data)}`,
			)
		console.log('[emqx-provision] Created webhook action')
	} else {
		console.log('[emqx-provision] Webhook action already exists')
	}

	// 3. Rule
	const rule = await api(token, 'GET', `/rules/${RULE_ID}`)
	if (rule.status === 404) {
		const created = await api(token, 'POST', '/rules', {
			id: RULE_ID,
			sql: 'SELECT clientid, username, reason, disconnected_at, event FROM "$events/client_disconnected"',
			actions: [`http:${ACTION_NAME}`],
			enable: true,
		})
		if (!created.ok)
			throw new Error(
				`Failed to create rule: ${JSON.stringify(created.data)}`,
			)
		console.log('[emqx-provision] Created disconnect rule')
	} else {
		console.log('[emqx-provision] Disconnect rule already exists')
	}
}
