// Match state as the Nakama runtime hands it back. Between two match calls the
// state lives in Go, and the JS side reads it through wrappers: every read of a
// nested object or array makes a new wrapper, so `state.a === state.a` is false
// there even though nothing changed. A decision that compares two nested
// objects with `===` passes on plain objects and misfires on the server.
//
// `fromRuntime` wraps a plain value the same way, for tests that prove a
// decision reads values, never object identity.
//
// Not modelled: the key order of a Go map changing between reads, and
// `undefined` coming back as `null`.
export function fromRuntime<T>(value: T): T {
	if (typeof value !== 'object' || value === null) return value
	return new Proxy(value, {
		get: (target, key, receiver) =>
			fromRuntime(Reflect.get(target, key, receiver)),
	})
}
