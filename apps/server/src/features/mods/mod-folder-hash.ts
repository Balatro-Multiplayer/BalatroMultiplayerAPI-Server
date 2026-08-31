import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Canonical directory-content hash - a byte-for-byte Node port of the
// launcher's ModFileHash::hashDirectory() (see
// new-launcher/src/mods/modfilehash.cpp). This is what a mod's "approved
// hash" is computed over now: since mods deploy as real extracted folders
// (Steamodded mounting a .zip via NFS.mount() doesn't work correctly for
// every mod - see mods-sync.service.ts's own comment), there's no archive
// container left whose bytes would even be meaningful to hash, and hashing
// the folder's actual content directly sidesteps the entire
// "different zip tools produce different bytes for identical content"
// problem the old modzip/ZipWriter machinery existed to solve - a plain
// directory has no such ambiguity.
//
// Algorithm (must match ModFileHash::hashDirectory() exactly):
//   1. Recursively collect every regular file under root, as a path
//      relative to root, forward-slash separated (already true of Node's
//      own path.join on Linux, which is the only platform this runs on -
//      see Dockerfile).
//   2. Sort those relative paths with a plain default string sort -
//      equivalent to Qt's UTF-16 code-unit QString::operator< for every
//      realistic mod filename (confirmed by modzip.c's own predecessor
//      comment making the same claim about strcmp; Array.prototype.sort()'s
//      default UTF-16-code-unit comparison is the same equivalence).
//   3. Feed one running sha256 hash `relativePath (utf8 bytes) + file
//      contents`, per file, in sorted order. Note the root folder's own
//      name never enters the hash at all (paths are relative to it) -
//      unlike the old zip-based scheme, this means the launcher's and this
//      server's extracted-folder naming no longer has to match for the
//      hash to agree.
async function collectRelativeFilePaths(root: string, dir: string, out: string[]): Promise<void> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			await collectRelativeFilePaths(root, fullPath, out)
		} else if (entry.isFile()) {
			out.push(path.relative(root, fullPath).split(path.sep).join('/'))
		}
		// Symlinks/other entry types are skipped, same as modzip.c's old
		// lstat-based walk (S_ISDIR/S_ISREG only) and Qt's own
		// QDir::Files filter.
	}
}

export async function computeModFolderHash(root: string): Promise<string> {
	const relativePaths: string[] = []
	await collectRelativeFilePaths(root, root, relativePaths)
	relativePaths.sort()

	const hash = createHash('sha256')
	for (const relativePath of relativePaths) {
		hash.update(relativePath, 'utf8')
		hash.update(await fs.readFile(path.join(root, relativePath)))
	}
	return hash.digest('hex')
}
