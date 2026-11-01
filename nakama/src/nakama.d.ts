// The slice of Nakama's JavaScript runtime API (3.41) this module uses.
// Hand-written rather than pulling in heroiclabs/nakama-common: that package
// is only published from git, and this keeps the build dependency-free.
declare namespace nkruntime {
	interface Context {
		env: { [key: string]: string }
		userId: string
		username: string
		matchId: string
		// The calling socket's session (realtime hooks, socket RPCs).
		sessionId?: string
		// The client's address as Nakama sees it: the first X-Forwarded-For
		// entry, else the peer (nginx/prod/server.conf sets the header).
		clientIp?: string
	}

	interface Logger {
		debug(format: string, ...params: unknown[]): void
		info(format: string, ...params: unknown[]): void
		warn(format: string, ...params: unknown[]): void
		error(format: string, ...params: unknown[]): void
	}

	interface HttpResponse {
		code: number
		headers: { [key: string]: string[] }
		body: string
	}

	interface Match {
		matchId: string
		authoritative: boolean
		label: string
		size: number
	}

	interface StorageReadRequest {
		collection: string
		key: string
		userId: string
	}

	interface StorageObject {
		collection: string
		key: string
		userId: string
		value: { [key: string]: unknown }
		// Changes with every write; pass it back to write only if unchanged.
		version?: string
	}

	interface StorageWriteRequest {
		collection: string
		key: string
		userId: string
		value: { [key: string]: unknown }
		permissionRead: 0 | 1 | 2
		permissionWrite: 0 | 1
		// '*' writes only if the object doesn't exist yet (throws otherwise).
		version?: string
	}

	interface Nakama {
		httpRequest(
			url: string,
			method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head',
			headers: { [key: string]: string },
			body: string,
			timeout: number,
		): HttpResponse
		binaryToString(data: ArrayBuffer): string
		matchCreate(module: string, params: { [key: string]: unknown }): string
		matchGet(id: string): Match | null
		matchList(
			limit: number,
			authoritative: boolean | null,
			label: string | null,
			minSize: number | null,
			maxSize: number | null,
			query: string | null,
		): Match[]
		matchSignal(id: string, data: string): string
		// Presences on a stream; mode 0 (notifications) holds every
		// connected session of the user named by subject.
		streamUserList(
			stream: { mode: number; subject?: string; subcontext?: string; label?: string },
			includeHidden?: boolean,
			includeNotHidden?: boolean,
		): Presence[]
		// Removes a presence from a stream. On a party's stream (mode 7) the
		// member is out of the party (its tickets go) without being told.
		streamUserKick(presence: { userId: string; sessionId: string; node: string }, stream: { mode: number; subject?: string; subcontext?: string; label?: string }): void
		storageRead(reads: StorageReadRequest[]): StorageObject[]
		storageWrite(writes: StorageWriteRequest[]): unknown
		storageDelete(deletes: StorageReadRequest[]): void
		// userId null lists the collection across every owner ('' is refused).
		storageList(
			userId: string | null,
			collection: string,
			limit: number,
			cursor: string,
		): { objects?: StorageObject[]; cursor?: string }
		leaderboardCreate(
			id: string,
			authoritative: boolean,
			sortOrder: 'asc' | 'desc',
			operator: 'best' | 'set' | 'incr' | 'decr',
			resetSchedule: string | null,
			metadata: { [key: string]: unknown },
		): void
		leaderboardRecordWrite(
			id: string,
			ownerId: string,
			username: string,
			score: number,
			subscore: number,
			metadata: { [key: string]: unknown },
			overrideOperator?: 'best' | 'set' | 'incr' | 'decr',
		): LeaderboardRecord
		leaderboardRecordDelete(id: string, ownerId: string): void
		leaderboardRecordsList(
			id: string,
			ownerIds: string[] | null,
			limit: number,
			cursor: string,
			expiry: number,
		): { records?: LeaderboardRecord[]; ownerRecords?: LeaderboardRecord[]; nextCursor?: string }
		uuidv4(): string
		accountGetId(userId: string): Account
		// Every argument but userId may be null to leave that field unchanged.
		accountUpdateId(
			userId: string,
			username: string | null,
			displayName: string | null,
			timezone: string | null,
			location: string | null,
			langTag: string | null,
			avatarUrl: string | null,
			metadata: { [key: string]: unknown } | null,
		): void
		sha256Hash(input: string): string
		// Rows as objects keyed by column name.
		sqlQuery(query: string, parameters?: unknown[]): { [column: string]: unknown }[]
		linkDevice(userId: string, deviceId: string): void
		unlinkDevice(userId: string, deviceId: string): void
		// Banned users can't log in or refresh a session.
		usersBanId(userIds: string[]): void
		usersUnbanId(userIds: string[]): void
		// Revokes the user's session tokens; '' for both revokes every one.
		sessionLogout(userId: string, token: string, refreshToken: string): void
		// Deletes the user and everything they own (recorded: keep a tombstone).
		accountDeleteId(userId: string, recorded?: boolean): void
		// code must be positive (Nakama reserves zero and below).
		notificationSend(
			userId: string,
			subject: string,
			content: { [key: string]: unknown },
			code: number,
			senderId: string,
			persistent: boolean,
		): void
	}

	interface Account {
		user: {
			id: string
			username: string
			displayName?: string
			metadata?: { [key: string]: unknown }
		}
		customId: string
		devices?: { id: string }[]
	}

	// A realtime message from a client socket (registerRtBefore/After).
	type Envelope = { [key: string]: unknown }

	interface SessionEvent {
		properties: { [key: string]: string }
		timestamp: number
	}

	interface LeaderboardRecord {
		ownerId: string
		username: string
		score: number
		subscore: number
		metadata: { [key: string]: unknown }
		rank: number
	}

	interface Presence {
		userId: string
		sessionId: string
		username: string
		node: string
	}

	interface MatchMessage {
		sender: Presence
		opCode: number
		data: ArrayBuffer
		reliable: boolean
		receiveTimeMs: number
	}

	interface MatchDispatcher {
		broadcastMessage(
			opCode: number,
			data: string,
			presences: Presence[] | null,
			sender: Presence | null,
			reliable: boolean,
		): void
		matchKick(presences: Presence[]): void
		matchLabelUpdate(label: string): void
	}

	type MatchState = { [key: string]: unknown }

	interface MatchHandler<S extends MatchState> {
		matchInit(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			params: { [key: string]: unknown },
		): { state: S; tickRate: number; label: string }
		matchJoinAttempt(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			presence: Presence,
			metadata: { [key: string]: string },
		): { state: S; accept: boolean; rejectMessage?: string } | null
		matchJoin(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			presences: Presence[],
		): { state: S } | null
		matchLeave(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			presences: Presence[],
		): { state: S } | null
		matchLoop(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			messages: MatchMessage[],
		): { state: S } | null
		matchTerminate(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			graceSeconds: number,
		): { state: S } | null
		matchSignal(
			ctx: Context,
			logger: Logger,
			nk: Nakama,
			dispatcher: MatchDispatcher,
			tick: number,
			state: S,
			data: string,
		): { state: S; data?: string } | null
	}

	interface AuthenticateCustomRequest {
		account?: { id?: string; vars?: { [key: string]: string } }
		create?: boolean
		username?: string
	}

	interface AuthenticateDeviceRequest {
		account?: { id?: string; vars?: { [key: string]: string } }
		create?: boolean
		username?: string
	}

	interface AccountCustom {
		id?: string
		vars?: { [key: string]: string }
	}

	type BeforeHookFunction<T> = (
		ctx: Context,
		logger: Logger,
		nk: Nakama,
		data: T,
	) => T | undefined
	type AfterHookFunction<Res, Req> = (
		ctx: Context,
		logger: Logger,
		nk: Nakama,
		data: Res,
		request: Req,
	) => void
	type RpcFunction = (
		ctx: Context,
		logger: Logger,
		nk: Nakama,
		payload: string,
	) => string | undefined

	interface Initializer {
		registerBeforeAuthenticateCustom(
			fn: BeforeHookFunction<AuthenticateCustomRequest>,
		): void
		registerBeforeAuthenticateDevice(
			fn: BeforeHookFunction<AuthenticateDeviceRequest>,
		): void
		registerAfterAuthenticateCustom(
			fn: AfterHookFunction<{ created?: boolean }, AuthenticateCustomRequest>,
		): void
		registerBeforeLinkCustom(fn: BeforeHookFunction<AccountCustom>): void
		registerBeforeUnlinkCustom(fn: BeforeHookFunction<AccountCustom>): void
		registerBeforeDeleteAccount(fn: (ctx: Context, logger: Logger, nk: Nakama) => void): void
		registerRpc(id: string, fn: RpcFunction): void
		registerBeforeSessionRefresh(
			fn: BeforeHookFunction<{ token?: string; vars?: { [key: string]: string } }>,
		): void
		// No session start/end events: 3.41's JS runtime only has them for Go.
		// id is the envelope's message name, e.g. 'MatchmakerAdd'. Returning
		// nothing (or throwing) drops the message.
		registerRtBefore(
			id: string,
			fn: (ctx: Context, logger: Logger, nk: Nakama, envelope: Envelope) => Envelope | void,
		): void
		registerRtAfter(
			id: string,
			fn: (ctx: Context, logger: Logger, nk: Nakama, output: Envelope | null, input: Envelope) => void,
		): void
		registerShutdown(fn: (ctx: Context, logger: Logger, nk: Nakama) => void): void
		registerMatchmakerMatched(
			fn: (
				ctx: Context,
				logger: Logger,
				nk: Nakama,
				// Numeric ticket properties arrive merged into properties;
				// partyId is set on a party ticket's members.
				matches: {
					presence: Presence
					properties: { [key: string]: string | number }
					partyId?: string
				}[],
			) => string | void,
		): void
		registerMatch<S extends MatchState>(
			name: string,
			handler: MatchHandler<S>,
		): void
	}

	interface Error {
		code: number
		message: string
	}
}
