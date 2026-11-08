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
import { rpcAdminRatingsReplayFold, rpcAdminRatingsReplayList } from './rating/replay'
import {
	rpcAdminRatingsBoardExport,
	rpcAdminRatingsSeasonClear,
	rpcAdminRatingsSeasonExport,
} from './rating/season_board'
import { rpcAdminRunGet, rpcAdminRunSetResult } from './review/rpc'
import { rpcRunGet, rpcRunLogs, rpcRunsMine } from './lobby/storage'
import { rpcLegacyRatingsImport } from './rating/legacy'
import { configureSeason } from './rating/season'
import { seedAllowedModIdsExtra } from './standing/seed'
import { refuseClientAccountDelete, rpcAdminAccountDelete, rpcAdminProfileSet } from './player/admin'
import { rpcSessionInit, rpcTosAccept } from './player/session'
import { rpcMuteSet, rpcProfileSetDisplay, rpcProfileSetJoker, rpcProfileSetMods } from './player/rpc'
import { rpcReportSubmit } from './moderation/report'
import { rpcAdminDiscordSet, rpcDiscordLinkStart, rpcDiscordUnlink } from './player/discord'
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
import {
	rpcAdminTournamentClose,
	rpcTournamentCancel,
	rpcTournamentCheckIn,
	rpcTournamentCoOrganisersSet,
	rpcTournamentCoOrganiserCode,
	rpcTournamentCoOrganiserJoin,
	rpcTournamentNoticeSet,
	rpcTournamentMessage,
	rpcTournamentCanCreate,
	rpcTournamentCreate,
	rpcTournamentGet,
	rpcTournamentPreview,
	rpcTournamentJoin,
	rpcTournamentLeave,
	rpcTournamentList,
	rpcTournamentMine,
	rpcTournamentOpen,
	rpcTournamentPause,
	rpcTournamentPromote,
	rpcTournamentReady,
	rpcTournamentRegistrationSet,
	rpcTournamentRemovePlayer,
	rpcTournamentResultClear,
	rpcTournamentResultSet,
	rpcTournamentResume,
	rpcTournamentRoundStart,
	rpcTournamentExtend,
	rpcTournamentSeedingSet,
	rpcTournamentStart,
	rpcTournamentUpdate,
} from './tournament/rpc'
import { rpcAdminTournamentGet, rpcAdminTournamentList } from './tournament/admin'
import { rpcTournamentDevFill, rpcTournamentDevTime } from './tournament/dev'
import { ensureClock } from './tournament/clock'
import {
	tournamentClockInit,
	tournamentClockJoin,
	tournamentClockJoinAttempt,
	tournamentClockLeave,
	tournamentClockLoop,
	tournamentClockSignal,
	tournamentClockTerminate,
} from './tournament/clock_match'

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
	initializer.registerRpc('discord_link_start', rpcDiscordLinkStart)
	initializer.registerRpc('discord_unlink', rpcDiscordUnlink)
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
	initializer.registerRpc('admin_run_get', rpcAdminRunGet)
	initializer.registerRpc('admin_run_set_result', rpcAdminRunSetResult)
	initializer.registerRpc('admin_match_edit', rpcAdminMatchEdit)
	logger.info('BMP lobby module loaded')

	// In-client tournaments (tournament/), behind the tournamentsEnabled switch.
	initializer.registerMatch('bmp_tournament_clock', {
		matchInit: tournamentClockInit,
		matchJoinAttempt: tournamentClockJoinAttempt,
		matchJoin: tournamentClockJoin,
		matchLeave: tournamentClockLeave,
		matchLoop: tournamentClockLoop,
		matchSignal: tournamentClockSignal,
		matchTerminate: tournamentClockTerminate,
	})
	initializer.registerRpc('tournament_list', rpcTournamentList)
	initializer.registerRpc('tournament_get', rpcTournamentGet)
	initializer.registerRpc('tournament_preview', rpcTournamentPreview)
	initializer.registerRpc('tournament_mine', rpcTournamentMine)
	initializer.registerRpc('tournament_join', rpcTournamentJoin)
	initializer.registerRpc('tournament_leave', rpcTournamentLeave)
	initializer.registerRpc('tournament_check_in', rpcTournamentCheckIn)
	initializer.registerRpc('tournament_create', rpcTournamentCreate)
	initializer.registerRpc('tournament_can_create', rpcTournamentCanCreate)
	initializer.registerRpc('tournament_update', rpcTournamentUpdate)
	initializer.registerRpc('tournament_open', rpcTournamentOpen)
	initializer.registerRpc('tournament_registration_set', rpcTournamentRegistrationSet)
	initializer.registerRpc('tournament_promote', rpcTournamentPromote)
	initializer.registerRpc('tournament_remove_player', rpcTournamentRemovePlayer)
	initializer.registerRpc('tournament_co_organisers_set', rpcTournamentCoOrganisersSet)
	initializer.registerRpc('tournament_co_organiser_code', rpcTournamentCoOrganiserCode)
	initializer.registerRpc('tournament_co_organiser_join', rpcTournamentCoOrganiserJoin)
	initializer.registerRpc('tournament_notice_set', rpcTournamentNoticeSet)
	initializer.registerRpc('tournament_message', rpcTournamentMessage)
	initializer.registerRpc('tournament_seeding_set', rpcTournamentSeedingSet)
	initializer.registerRpc('tournament_start', rpcTournamentStart)
	initializer.registerRpc('tournament_cancel', rpcTournamentCancel)
	initializer.registerRpc('tournament_ready', rpcTournamentReady)
	initializer.registerRpc('tournament_result_set', rpcTournamentResultSet)
	initializer.registerRpc('tournament_result_clear', rpcTournamentResultClear)
	initializer.registerRpc('tournament_extend', rpcTournamentExtend)
	initializer.registerRpc('tournament_pause', rpcTournamentPause)
	initializer.registerRpc('tournament_resume', rpcTournamentResume)
	initializer.registerRpc('tournament_round_start', rpcTournamentRoundStart)
	initializer.registerRpc('admin_tournament_close', rpcAdminTournamentClose)
	initializer.registerRpc('admin_tournament_list', rpcAdminTournamentList)
	initializer.registerRpc('admin_tournament_get', rpcAdminTournamentGet)
	initializer.registerRpc('tournament_dev_fill', rpcTournamentDevFill)
	initializer.registerRpc('tournament_dev_time', rpcTournamentDevTime)
	// Starting a match may not be allowed this early; any tournament RPC
	// starts the clock otherwise.
	ensureClock(nk)
	logger.info('BMP tournament module loaded')
}

// Nothing calls InitModule inside the bundle; this reference keeps esbuild
// from tree-shaking it away (Nakama calls it by name).
// @ts-ignore
!InitModule && InitModule.bind(null)
