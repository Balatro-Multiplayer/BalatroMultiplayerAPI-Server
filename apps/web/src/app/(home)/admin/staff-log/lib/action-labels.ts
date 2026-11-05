// The server's STAFF_ACTIONS (apps/server shared/staff-log/actions.ts).
export const STAFF_ACTION_LABELS: Record<string, string> = {
  warn: 'Warning',
  note: 'Note',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  lift_ban: 'Lift',
  lift_network_ban: 'Lift network ban',
  lift_warning: 'Lift warning',
  dismiss: 'Dismiss',
  resolve: 'Resolve',
  void: 'Void match',
  overturn: 'Change result',
  reopen: 'Reopen',
  appeal_deny: 'Deny appeal',
  appeal_grant: 'Grant appeal',
  match_result: 'Edit match result',
  match_void: 'Void match (match page)',
  role_grant: 'Give role',
  role_remove: 'Remove role',
  lobby_kick: 'Kick from lobby',
  lobby_close: 'Close lobby',
  config_change: 'Change server config',
  allowlist_add: 'Add allowlist message',
  allowlist_remove: 'Remove allowlist message',
  season_start: 'Start season',
  season_activate: 'Activate season',
  season_end: 'End season',
  mod_pin: 'Change ranked mod pin',
  custom_mod_create: 'Create custom mod',
  custom_mod_update: 'Edit custom mod',
  custom_mod_delete: 'Delete custom mod',
  mod_profile_create: 'Create mod profile',
  mod_profile_update: 'Edit mod profile',
  mod_profile_delete: 'Delete mod profile',
  mod_profile_entry_set: 'Set mod profile entry',
  mod_profile_entry_remove: 'Remove mod profile entry',
  mods_sync: 'Sync mod catalog',
  smods_ids_backfill: 'Backfill SMODS ids',
  achievements_backfill: 'Backfill achievements',
  launcher_release_import: 'Import launcher release',
  launcher_release_delete: 'Delete launcher release',
  blog_create: 'Create blog post',
  blog_update: 'Edit blog post',
  blog_publish: 'Publish blog post',
  blog_unpublish: 'Unpublish blog post',
  blog_delete: 'Delete blog post',
  ladder_edit: 'Edit strike ladder',
  preset_reasons_edit: 'Edit preset reasons',
  season_replay_apply: 'Apply season replay',
  season_replay_restore: 'Restore season replay backup',
}

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'plain'

// The badge colour of an action: punishments red, warnings amber, lifts and
// dismissals green, notes blue.
export function toneOf(action: string): Tone {
  if (['chat_ban', 'queue_ban', 'account_ban', 'lobby_close'].includes(action))
    return 'red'
  if (['warn', 'void', 'match_void', 'overturn', 'match_result'].includes(action))
    return 'amber'
  if (action.startsWith('lift') || ['dismiss', 'resolve', 'appeal_grant'].includes(action))
    return 'green'
  if (['note', 'reopen'].includes(action)) return 'blue'
  return 'plain'
}
