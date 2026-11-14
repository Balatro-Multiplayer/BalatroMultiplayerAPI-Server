// The one place a test fake is handed to code that wants the real runtime type.
// The fakes implement only what the code under test calls.

export function asNakama(fake: object): nkruntime.Nakama {
	return fake as unknown as nkruntime.Nakama
}

export function asEnvelope(envelope: object): nkruntime.Envelope {
	return envelope as unknown as nkruntime.Envelope
}
