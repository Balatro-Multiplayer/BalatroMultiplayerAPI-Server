// Nakama JavaScript runtime entry point (bundled to modules/index.js by
// build.mjs). Nakama resolves every function registered here by its name in
// the script's global scope, so they are passed as plain identifiers.
import { rpcAccountStanding } from './standing/rpc'
import { rpcAdminAvatarsFor, rpcAdminProgressSet, rpcAvatarCatalog } from './achievements/rpc'
import { rpcAdminAchievementsBackfill } from './achievements/backfill'
import { rpcAdminAvatarsReset } from './achievements/reset'
import {
	rpcAdminBanApply,
	rpcAdminBanIndexForget,
	rpcAdminBanLift,
	rpcAdminConfigSet,
	rpcAdminLobbyClose,
	rpcAdminLobbyGet,
	rpcAdminLobbyKick,
	rpcAdminLobbyList,
	rpcAdminMirrorAck,
	rpcAdminMirrorPull,
	rpcAdminNotify,
	rpcAdminPing,
	rpcAdminPlayerGet,
} from './admin'
import {
	afterAuthenticateCustom,
	beforeAuthenticateCustom,
	beforeAuthenticateDevice,
	beforeSessionRefresh,
	refuseCustomIdChange,
} from './auth'
import {
	lobbyMatchInit,
	lobbyMatchJoin,
	lobbyMatchJoinAttempt,
	lobbyMatchLeave,
	lobbyMatchLoop,
	lobbyMatchSignal,
	lobbyMatchTerminate,
} from './lobby/match'
import {
	rpcLobbyCreate,
	rpcLobbyCurrent,
	rpcLobbyFind,
	rpcSpectateList,
	rpcLobbyLeave,
	rpcRunActive,
} from './lobby/rpc'
import { rpcChatEnable, rpcChatSend } from './chat/rpc'
import { beforeMatchmakerAdd } from './matchmaking/gate'
import { matchmakerMatched } from './matchmaking/matched'
import {
	afterPartyMatchmakerAdd,
	beforePartyClose,
	beforePartyJoin,
	beforePartyLeave,
	beforePartyMatchmakerAdd,
	beforePartyMatchmakerRemove,
	beforePartyRemove,
} from './matchmaking/group/hooks'
import { rpcGroupQueueCancel, rpcGroupQueueOpen } from './matchmaking/group/rpc'
import {
	afterMatchmakerAdd,
	beforeMatchmakerRemove,
	rpcQueueCounts,
} from './matchmaking/queue'
import { rpcLeaderboardGet, rpcRatingGet } from './rating/rpc'
import { rpcAdminCheckpointsSweep } from './lobby/checkpoint_sweep'
import { rpcAdminRunsExpired, rpcAdminRunsPurgeNamed } from './lobby/retention'
import { rpcAdminRatingsSet } from './rating/admin'
import { rpcAdminMatchEdit } from './rating/match_edit'
import { rpcAdminReportAction } from './notification/report_action'
import { rpcAdminRunTellVoided } from './notification/tell_voided'
import { rpcAdminRatingsReplayFold, rpcAdminRatingsReplayList } from './rating/replay'
import {
	rpcAdminRatingsBoardExport,
	rpcAdminRatingsSeasonClear,
	rpcAdminRatingsSeasonExport,
} from './rating/season_board'
import { rpcAdminRunGet, rpcAdminRunSetResult } from './review/rpc'
import { rpcRunGet, rpcRunLogs, rpcRunsMine } from './lobby/storage'
import { rpcLegacyRatingsImport } from './rating/legacy'
import { rpcAdminSeasonEndNotify } from './notification/season_end'
import { rpcAdminPunishmentNotify } from './notification/punishment'
import { configureSeason } from './rating/season'
import { seedAllowedModIdsExtra } from './standing/seed'
import { refuseClientAccountDelete, rpcAdminAccountDelete, rpcAdminProfileSet } from './player/admin'
import { rpcSessionInit, rpcTosAccept } from './player/session'
import { rpcAdminContestWithdrawn } from './notification/contest_withdrawn'
import { rpcNotificationsPending, rpcNotificationsRead } from './notification/rpc'
import { rpcMuteSet, rpcProfileSetDisplay, rpcProfileSetJoker, rpcProfileSetMods } from './player/rpc'
import { rpcReportSubmit } from './moderation/report'
import { rpcAdminDiscordSet, rpcDiscordLinkStart, rpcDiscordUnlink } from './player/discord'
import { rpcWebLoginLink } from './player/web_login'
import {
	rpcAdminIntegritySet,
	rpcAdminQueueCancel,
	rpcLauncherChallengeAnswer,
	rpcLauncherSessionStart,
} from './integrity'
import { checkServerKind } from './server_kind'
import { requireIpHashSalt } from './moderation/network'
import {
	rpcAdminIpHashesPurge,
	rpcAdminNetworkBanLift,
	rpcAdminNetworkBans,
	rpcAdminNetworkCheck,
	rpcAdminPlayerNetworks,
} from './moderation/network_admin'

function InitModule(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	initializer: nkruntime.Initializer,
) {
	// Throws on a bad BMP_SERVER_KIND or a refused dev flag, so Nakama stops.
	const settings = checkServerKind(ctx.env, logger)
	requireIpHashSalt(settings, ctx.env)
	configureSeason(ctx.env['RATING_SEASON'])
	seedAllowedModIdsExtra(nk, logger, ctx.env)
	initializer.registerBeforeAuthenticateCustom(beforeAuthenticateCustom)
	initializer.registerAfterAuthenticateCustom(afterAuthenticateCustom)
	initializer.registerBeforeLinkCustom(refuseCustomIdChange)
	initializer.registerBeforeUnlinkCustom(refuseCustomIdChange)
	initializer.registerBeforeDeleteAccount(refuseClientAccountDelete)
	initializer.registerBeforeAuthenticateDevice(beforeAuthenticateDevice)
	initializer.registerBeforeSessionRefresh(beforeSessionRefresh)
	logger.info('BMP Steam login module loaded')

	// Literal, not LOBBY_MATCH: Nakama reads the registration calls from this
	// function's source, so the name must be spelled out here.
	initializer.registerMatch('bmp_lobby', {
		matchInit: lobbyMatchInit,
		matchJoinAttempt: lobbyMatchJoinAttempt,
		matchJoin: lobbyMatchJoin,
		matchLeave: lobbyMatchLeave,
		matchLoop: lobbyMatchLoop,
		matchSignal: lobbyMatchSignal,
		matchTerminate: lobbyMatchTerminate,
	})
	initializer.registerMatchmakerMatched(matchmakerMatched)
	initializer.registerRtBefore('MatchmakerAdd', beforeMatchmakerAdd)
	initializer.registerRtAfter('MatchmakerAdd', afterMatchmakerAdd)
	initializer.registerRtBefore('MatchmakerRemove', beforeMatchmakerRemove)
	initializer.registerRtBefore('PartyJoin', beforePartyJoin)
	initializer.registerRtBefore('PartyMatchmakerAdd', beforePartyMatchmakerAdd)
	initializer.registerRtAfter('PartyMatchmakerAdd', afterPartyMatchmakerAdd)
	initializer.registerRtBefore('PartyMatchmakerRemove', beforePartyMatchmakerRemove)
	initializer.registerRtBefore('PartyLeave', beforePartyLeave)
	initializer.registerRtBefore('PartyRemove', beforePartyRemove)
	initializer.registerRtBefore('PartyClose', beforePartyClose)
	initializer.registerRpc('group_queue_open', rpcGroupQueueOpen)
	initializer.registerRpc('group_queue_cancel', rpcGroupQueueCancel)
	initializer.registerRpc('queue_counts', rpcQueueCounts)
	initializer.registerRpc('session_init', rpcSessionInit)
	initializer.registerRpc('tos_accept', rpcTosAccept)
	initializer.registerRpc('profile_set_display', rpcProfileSetDisplay)
	initializer.registerRpc('profile_set_joker', rpcProfileSetJoker)
	initializer.registerRpc('profile_set_mods', rpcProfileSetMods)
	initializer.registerRpc('account_standing', rpcAccountStanding)
	initializer.registerRpc('avatar_catalog', rpcAvatarCatalog)
	initializer.registerRpc('mute_set', rpcMuteSet)
	initializer.registerRpc('notifications_pending', rpcNotificationsPending)
	initializer.registerRpc('notifications_read', rpcNotificationsRead)
	initializer.registerRpc('discord_link_start', rpcDiscordLinkStart)
	initializer.registerRpc('discord_unlink', rpcDiscordUnlink)
	initializer.registerRpc('web_login_link', rpcWebLoginLink)
	initializer.registerRpc('chat_enable', rpcChatEnable)
	initializer.registerRpc('chat_send', rpcChatSend)
	initializer.registerRpc('report_submit', rpcReportSubmit)
	initializer.registerRpc('launcher_session_start', rpcLauncherSessionStart)
	initializer.registerRpc('launcher_challenge_answer', rpcLauncherChallengeAnswer)
	initializer.registerRpc('lobby_create', rpcLobbyCreate)
	initializer.registerRpc('lobby_find', rpcLobbyFind)
	initializer.registerRpc('spectate_list', rpcSpectateList)
	initializer.registerRpc('lobby_current', rpcLobbyCurrent)
	initializer.registerRpc('lobby_leave', rpcLobbyLeave)
	initializer.registerRpc('run_active', rpcRunActive)
	initializer.registerRpc('run_get', rpcRunGet)
	initializer.registerRpc('run_logs', rpcRunLogs)
	initializer.registerRpc('runs_mine', rpcRunsMine)
	initializer.registerRpc('legacy_ratings_import', rpcLegacyRatingsImport)
	initializer.registerRpc('rating_get', rpcRatingGet)
	initializer.registerRpc('leaderboard_get', rpcLeaderboardGet)
	// Server to server only (http key); see admin.ts.
	initializer.registerRpc('admin_ping', rpcAdminPing)
	initializer.registerRpc('admin_notify', rpcAdminNotify)
	initializer.registerRpc('admin_contest_withdrawn', rpcAdminContestWithdrawn)
	initializer.registerRpc('admin_config_set', rpcAdminConfigSet)
	initializer.registerRpc('admin_ban_apply', rpcAdminBanApply)
	initializer.registerRpc('admin_ban_lift', rpcAdminBanLift)
	initializer.registerRpc('admin_ban_index_forget', rpcAdminBanIndexForget)
	initializer.registerRpc('admin_network_bans', rpcAdminNetworkBans)
	initializer.registerRpc('admin_network_ban_lift', rpcAdminNetworkBanLift)
	initializer.registerRpc('admin_network_check', rpcAdminNetworkCheck)
	initializer.registerRpc('admin_player_networks', rpcAdminPlayerNetworks)
	initializer.registerRpc('admin_ip_hashes_purge', rpcAdminIpHashesPurge)
	initializer.registerRpc('admin_lobby_list', rpcAdminLobbyList)
	initializer.registerRpc('admin_lobby_get', rpcAdminLobbyGet)
	initializer.registerRpc('admin_lobby_kick', rpcAdminLobbyKick)
	initializer.registerRpc('admin_lobby_close', rpcAdminLobbyClose)
	initializer.registerRpc('admin_player_get', rpcAdminPlayerGet)
	initializer.registerRpc('admin_discord_set', rpcAdminDiscordSet)
	initializer.registerRpc('admin_integrity_set', rpcAdminIntegritySet)
	initializer.registerRpc('admin_queue_cancel', rpcAdminQueueCancel)
	initializer.registerRpc('admin_mirror_pull', rpcAdminMirrorPull)
	initializer.registerRpc('admin_mirror_ack', rpcAdminMirrorAck)
	initializer.registerRpc('admin_profile_set', rpcAdminProfileSet)
	initializer.registerRpc('admin_account_delete', rpcAdminAccountDelete)
	initializer.registerRpc('admin_avatars_for', rpcAdminAvatarsFor)
	initializer.registerRpc('admin_progress_set', rpcAdminProgressSet)
	initializer.registerRpc('admin_avatars_reset', rpcAdminAvatarsReset)
	initializer.registerRpc('admin_achievements_backfill', rpcAdminAchievementsBackfill)
	initializer.registerRpc('admin_runs_expired', rpcAdminRunsExpired)
	initializer.registerRpc('admin_runs_purge_named', rpcAdminRunsPurgeNamed)
	initializer.registerRpc('admin_checkpoints_sweep', rpcAdminCheckpointsSweep)
	initializer.registerRpc('admin_ratings_set', rpcAdminRatingsSet)
	initializer.registerRpc('admin_ratings_replay_list', rpcAdminRatingsReplayList)
	initializer.registerRpc('admin_ratings_replay_fold', rpcAdminRatingsReplayFold)
	initializer.registerRpc('admin_ratings_season_export', rpcAdminRatingsSeasonExport)
	initializer.registerRpc('admin_ratings_board_export', rpcAdminRatingsBoardExport)
	initializer.registerRpc('admin_ratings_season_clear', rpcAdminRatingsSeasonClear)
	initializer.registerRpc('admin_season_end_notify', rpcAdminSeasonEndNotify)
	initializer.registerRpc('admin_punishment_notify', rpcAdminPunishmentNotify)
	initializer.registerRpc('admin_run_get', rpcAdminRunGet)
	initializer.registerRpc('admin_run_set_result', rpcAdminRunSetResult)
	initializer.registerRpc('admin_match_edit', rpcAdminMatchEdit)
	initializer.registerRpc('admin_run_tell_voided', rpcAdminRunTellVoided)
	initializer.registerRpc('admin_report_action', rpcAdminReportAction)
	logger.info('BMP lobby module loaded')
}

// Nothing calls InitModule inside the bundle; this reference keeps esbuild
// from tree-shaking it away (Nakama calls it by name).
// @ts-ignore
!InitModule && InitModule.bind(null)
