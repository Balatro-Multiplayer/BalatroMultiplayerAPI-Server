/** An opaque game archive for React state/props. Development render inspection
 * enumerates object properties, which is prohibitively expensive for millions
 * of Uint8Array indices. Keep the bytes private and unwrap only in readers. */
export class GameArchive {
  #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  readBytes(): Uint8Array {
    return this.#bytes
  }
}
