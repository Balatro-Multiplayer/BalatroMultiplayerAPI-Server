// Opening a website page for a player who is logged in in game. The API
// holds the website sessions: web_login_link asks it for a one-time link
// (apps/server/src/features/nakama/web-login-link.ts), which logs the player
// in to the website once, within minutes, and lands on the page.
import { INVALID_ARGUMENT, UNAVAILABLE, runtimeError } from '../errors'
import { callExpress } from '../express'
import { parsePayload, requireUser } from '../rpc'

const MAX_PATH = 200

// {path} -> {url}. path is a page of the website ("/matches/<runId>"); the
// API makes the final check and refuses anything that is not one.
export function rpcWebLoginLink(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const { path } = parsePayload(payload)
	if (typeof path !== 'string' || path.length > MAX_PATH || path.charAt(0) !== '/' || path.charAt(1) === '/')
		throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid path')
	const reply = callExpress(nk, logger, ctx.env, '/web-login/link', { nakamaUserId: userId, path })
	const url = reply && reply.status === 200 ? reply.body.url : null
	if (typeof url !== 'string') throw runtimeError(UNAVAILABLE, 'Website login is unavailable right now')
	return JSON.stringify({ url })
}
