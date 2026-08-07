// Deterministic, cross-platform-independent mod archive builder, matching
// the launcher's own ZipWriter::zipDirectory() (see
// new-launcher/src/mods/zipwriter.cpp) byte-for-byte: same library
// (libzip), same fixed per-entry mtime, same compression method/level,
// same sorted entry order, same single-top-level-wrapper-folder layout.
//
// This server hashes what this program produces instead of hashing the raw
// GitHub release archive, because the launcher never actually deploys that
// raw archive into a user's Mods folder -- it always extracts, flattens
// (drops wrapper/README/LICENSE clutter, promotes the real
// .lua-containing folder to the top -- see
// ../../src/features/mods/mod-archive-flatten.ts, a TypeScript port of the
// launcher's relocateModRoot()), and rezips first. The rezip step is what
// RunController::currentZipMatchesServerHash() actually hashes for Ranked
// verification, so that's what this needs to match, not the original
// download.
//
// Usage: modzip <sourceDir>
//   Writes the assembled zip's raw bytes to stdout. Diagnostics go to
//   stderr. Exit code 0 on success, 1 on any failure (missing/unreadable
//   sourceDir, a file read failure, a libzip error). sourceDir's contents
//   should already be flattened by the caller before this runs -- this
//   program only does the deterministic archive-building step.
//
// Deliberately no target-file argument, unlike ZipWriter::zipDirectory():
// the server only ever needs the resulting bytes to hash (see
// mods-sync.service.ts), never a persisted zip file, so writing straight to
// stdout avoids a temp-file round trip on the Node side.

#define _POSIX_C_SOURCE 200809L

#include <zip.h>

#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

// --- Growable array of heap-owned strings: the collected list of paths
// relative to sourceDir (see walk()). ---

typedef struct {
	char **items;
	size_t count;
	size_t capacity;
} string_list;

static void string_list_push(string_list *list, char *item)
{
	if (list->count == list->capacity) {
		list->capacity = list->capacity ? list->capacity * 2 : 64;
		list->items = realloc(list->items, list->capacity * sizeof(char *));
		if (!list->items) {
			fprintf(stderr, "modzip: out of memory\n");
			exit(1);
		}
	}
	list->items[list->count++] = item;
}

// Plain byte-wise comparison -- equivalent to Qt's UTF-16 code-unit
// QString::operator< for every codepoint below U+10000 (i.e. every
// realistic mod filename), which is what ZipWriter::zipDirectory()'s
// std::sort(relativePaths) actually sorts by.
static int compare_strings(const void *a, const void *b)
{
	return strcmp(*(const char *const *)a, *(const char *const *)b);
}

// Recursive walk of dir_path (starting at source_root itself), collecting
// every regular file's path relative to source_root, forward-slash
// separated (this only ever runs on Linux, so that's already the native
// separator). Mirrors QDirIterator(path, QDir::Files | QDir::NoDotAndDotDot,
// QDirIterator::Subdirectories): only regular files are collected -- no
// directory entries, since an archive's directories are always implicit
// from its file entries' paths, same as the Qt version. Symlinks are
// deliberately not followed (lstat, not stat): a mod archive legitimately
// containing one is vanishingly unlikely, and following one would open the
// door to escaping source_root entirely.
static void walk(const char *source_root, const char *dir_path, string_list *out)
{
	DIR *dir = opendir(dir_path);
	if (!dir) {
		fprintf(stderr, "modzip: couldn't read directory %s: %s\n", dir_path, strerror(errno));
		exit(1);
	}

	struct dirent *entry;
	while ((entry = readdir(dir)) != NULL) {
		if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
			continue;
		}

		size_t full_len = strlen(dir_path) + 1 + strlen(entry->d_name) + 1;
		char *full_path = malloc(full_len);
		snprintf(full_path, full_len, "%s/%s", dir_path, entry->d_name);

		struct stat st;
		if (lstat(full_path, &st) != 0) {
			fprintf(stderr, "modzip: couldn't stat %s: %s\n", full_path, strerror(errno));
			exit(1);
		}

		if (S_ISDIR(st.st_mode)) {
			walk(source_root, full_path, out);
			free(full_path);
		} else if (S_ISREG(st.st_mode)) {
			// full_path is "<source_root>/<relative...>" -- source_root
			// never ends in '/' (main() strips it), so the relative part
			// starts right after source_root's length plus the separator.
			const char *relative = full_path + strlen(source_root) + 1;
			string_list_push(out, strdup(relative));
			free(full_path);
		} else {
			free(full_path);
		}
	}

	closedir(dir);
}

// Strips any trailing slash and returns the final path component --
// mirrors QFileInfo(sourceDir).fileName(), which becomes the archive's
// single top-level wrapper folder name. See zipwriter.h's comment on why
// the *name* itself doesn't matter to Steamodded's loader, only that
// exactly one such folder exists -- it still has to match exactly here for
// the resulting hash to match what the launcher produces, though.
static const char *basename_of(const char *path)
{
	size_t len = strlen(path);
	for (size_t i = len; i > 0; i--) {
		if (path[i - 1] == '/') {
			return path + i;
		}
	}
	return path;
}

static void fail_zip_error(zip_error_t *err, const char *what)
{
	fprintf(stderr, "modzip: %s: %s\n", what, zip_error_strerror(err));
	zip_error_fini(err);
	exit(1);
}

int main(int argc, char **argv)
{
	if (argc != 2) {
		fprintf(stderr, "usage: modzip <sourceDir>\n");
		return 1;
	}

	// libzip's zip_file_set_mtime() packs the given time_t into the zip
	// entry's classic DOS date/time fields via the C library's *local*
	// time conversion, not UTC - confirmed empirically (same input bytes,
	// same fixed_mtime constant below, three different TZ env values
	// below produced three different embedded timestamps and therefore
	// three different archive hashes: 2000-01-01T00:00:00 read back as
	// 1999-12-31T19:00:00 under America/New_York, 2000-01-01T09:00:00
	// under Asia/Tokyo). A fixed time_t constant alone does not make the
	// output timezone-independent - forcing the process's own TZ to UTC
	// here does. Set before any zip_* call, and must happen in-process
	// (an inherited TZ env var from the caller can't be relied on).
	setenv("TZ", "UTC", 1);
	tzset();

	// Strip any trailing slash up front so basename_of() and the recursive
	// walk's prefix-stripping math both see a consistent, unambiguous
	// source_root.
	char source_root[PATH_MAX];
	strncpy(source_root, argv[1], sizeof(source_root) - 1);
	source_root[sizeof(source_root) - 1] = '\0';
	size_t root_len = strlen(source_root);
	while (root_len > 1 && source_root[root_len - 1] == '/') {
		source_root[--root_len] = '\0';
	}

	struct stat root_stat;
	if (stat(source_root, &root_stat) != 0 || !S_ISDIR(root_stat.st_mode)) {
		fprintf(stderr, "modzip: %s is not a directory\n", source_root);
		return 1;
	}

	string_list relative_paths = {0};
	walk(source_root, source_root, &relative_paths);
	qsort(relative_paths.items, relative_paths.count, sizeof(char *), compare_strings);

	const char *wrapper_name = basename_of(source_root);

	zip_error_t zerr;
	zip_error_init(&zerr);

	zip_source_t *archive_source = zip_source_buffer_create(NULL, 0, 0, &zerr);
	if (!archive_source) {
		fail_zip_error(&zerr, "couldn't create archive buffer");
	}
	// zip_open_from_source() below effectively consumes one reference;
	// this extra one keeps the finished archive's bytes readable
	// afterward -- mirrors zipwriter.cpp's own zip_source_keep() call.
	zip_source_keep(archive_source);

	zip_t *archive = zip_open_from_source(archive_source, ZIP_TRUNCATE, &zerr);
	if (!archive) {
		fail_zip_error(&zerr, "couldn't open archive");
	}
	zip_error_fini(&zerr);

	// Fixed epoch (2000-01-01T00:00:00Z) for every entry's mtime, and a
	// pinned explicit compression level -- exactly matching zipwriter.cpp's
	// kFixedEntryMtime/kCompressionLevel. A real filesystem mtime (varies
	// by extraction time/host clock) or an unpinned "default" compression
	// level would make an otherwise byte-identical mod hash differently
	// depending on when/where it was processed, defeating the entire point
	// of this rewrite.
	const time_t fixed_mtime = 946684800;
	const zip_uint32_t compression_level = 9;

	for (size_t i = 0; i < relative_paths.count; i++) {
		const char *relative = relative_paths.items[i];

		size_t full_len = strlen(source_root) + 1 + strlen(relative) + 1;
		char *full_path = malloc(full_len);
		snprintf(full_path, full_len, "%s/%s", source_root, relative);

		FILE *f = fopen(full_path, "rb");
		if (!f) {
			fprintf(stderr, "modzip: couldn't open %s: %s\n", full_path, strerror(errno));
			zip_discard(archive);
			return 1;
		}
		fseek(f, 0, SEEK_END);
		long size = ftell(f);
		fseek(f, 0, SEEK_SET);
		if (size < 0) {
			fprintf(stderr, "modzip: couldn't determine size of %s\n", full_path);
			fclose(f);
			zip_discard(archive);
			return 1;
		}

		// libzip owns this heap buffer from here (freep=1 below) -- it has
		// to stay valid until zip_close() actually assembles the archive,
		// well after this loop returns.
		void *data = malloc(size > 0 ? (size_t)size : 1);
		if (!data) {
			fprintf(stderr, "modzip: out of memory reading %s\n", full_path);
			fclose(f);
			zip_discard(archive);
			return 1;
		}
		size_t nread = size > 0 ? fread(data, 1, (size_t)size, f) : 0;
		fclose(f);
		if (nread != (size_t)size) {
			fprintf(stderr, "modzip: short read on %s\n", full_path);
			free(data);
			zip_discard(archive);
			return 1;
		}
		free(full_path);

		zip_source_t *entry_source = zip_source_buffer(archive, data, (zip_uint64_t)size, 1);
		if (!entry_source) {
			fprintf(stderr, "modzip: %s\n", zip_strerror(archive));
			free(data);
			zip_discard(archive);
			return 1;
		}

		size_t entry_name_len = strlen(wrapper_name) + 1 + strlen(relative) + 1;
		char *entry_name = malloc(entry_name_len);
		snprintf(entry_name, entry_name_len, "%s/%s", wrapper_name, relative);

		zip_int64_t index = zip_file_add(archive, entry_name, entry_source, ZIP_FL_ENC_UTF_8);
		free(entry_name);
		if (index < 0) {
			fprintf(stderr, "modzip: %s\n", zip_strerror(archive));
			zip_source_free(entry_source); // only needed on failure -- zip_file_add() owns it on success
			zip_discard(archive);
			return 1;
		}

		zip_file_set_mtime(archive, (zip_uint64_t)index, fixed_mtime, 0);
		zip_set_file_compression(archive, (zip_uint64_t)index, ZIP_CM_DEFLATE, compression_level);
	}

	if (zip_close(archive) != 0) {
		fprintf(stderr, "modzip: %s\n", zip_strerror(archive));
		zip_discard(archive);
		return 1;
	}
	// On success archive is freed by zip_close() itself; the finished
	// bytes now live inside archive_source, kept alive by the extra
	// zip_source_keep() reference above.

	if (zip_source_open(archive_source) < 0) {
		fprintf(stderr, "modzip: couldn't reopen the assembled archive buffer\n");
		zip_source_free(archive_source);
		return 1;
	}

	zip_stat_t stat_buf;
	zip_stat_init(&stat_buf);
	zip_source_stat(archive_source, &stat_buf);
	zip_int64_t total_size = (stat_buf.valid & ZIP_STAT_SIZE) ? (zip_int64_t)stat_buf.size : 0;

	char *buffer = malloc(total_size > 0 ? (size_t)total_size : 1);
	zip_int64_t total_read = 0;
	while (total_read < total_size) {
		zip_int64_t n = zip_source_read(archive_source, buffer + total_read,
		                                 (zip_uint64_t)(total_size - total_read));
		if (n <= 0) {
			break;
		}
		total_read += n;
	}
	zip_source_close(archive_source);
	zip_source_free(archive_source);

	if (total_read != total_size || total_size == 0) {
		fprintf(stderr, "modzip: couldn't read back the assembled archive buffer\n");
		return 1;
	}

	if (fwrite(buffer, 1, (size_t)total_size, stdout) != (size_t)total_size) {
		fprintf(stderr, "modzip: short write to stdout\n");
		return 1;
	}
	fflush(stdout);

	return 0;
}
