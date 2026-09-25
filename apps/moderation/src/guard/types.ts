// Shared guard types. Two-player mapping: the message being judged is
// 'sender', everyone else in the conversation is 'other'.

export type GuardSafety = 'Safe' | 'Unsafe' | 'Controversial' | 'unknown'

export type GuardTurn = { who: 'sender' | 'other'; text: string }
