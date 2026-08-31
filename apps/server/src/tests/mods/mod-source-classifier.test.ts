import { describe, expect, it } from 'vitest'
import {
	classifyDownloadUrl,
	resolveReliableDownloadUrl,
} from '../../features/mods/mod-source-classifier.js'

// Fixtures mirror the real URL shapes found across all 432 production
// mod_registry.latest_download_url values (see mod-source-classifier.ts's
// header comment for why this classification exists at all).
describe('classifyDownloadUrl', () => {
	it('classifies a branch archive URL as branch', () => {
		expect(
			classifyDownloadUrl('https://github.com/owner/repo/archive/refs/heads/main.zip'),
		).toBe('branch')
	})

	it('classifies a "latest release" asset URL as release', () => {
		expect(
			classifyDownloadUrl(
				'https://github.com/owner/repo/releases/latest/download/Mod.zip',
			),
		).toBe('release')
	})

	it('classifies a tagged release asset URL as release', () => {
		expect(
			classifyDownloadUrl(
				'https://github.com/owner/repo/releases/download/v1.0.0/Mod.zip',
			),
		).toBe('release')
	})

	it('classifies a refs/tags archive URL as release', () => {
		expect(
			classifyDownloadUrl('https://github.com/owner/repo/archive/refs/tags/v1.0.0.zip'),
		).toBe('release')
	})

	it('classifies a legacy (no refs/) tag archive URL as release', () => {
		expect(classifyDownloadUrl('https://github.com/owner/repo/archive/v1.0.0.zip')).toBe(
			'release',
		)
	})

	it('classifies an already-normalized codeload tag URL as release', () => {
		expect(
			classifyDownloadUrl('https://codeload.github.com/owner/repo/zip/refs/tags/v1.0.0'),
		).toBe('release')
	})

	it('classifies a GitLab archive URL as custom', () => {
		expect(
			classifyDownloadUrl(
				'https://gitlab.com/owner/repo/-/archive/master/repo-master.zip?ref_type=heads',
			),
		).toBe('custom')
	})

	it('classifies a raw.githubusercontent.com file URL as custom', () => {
		expect(
			classifyDownloadUrl('https://raw.githubusercontent.com/owner/repo/main/Mod.zip'),
		).toBe('custom')
	})

	it('classifies a malformed/unrecognized URL as custom', () => {
		expect(classifyDownloadUrl('not a url')).toBe('custom')
	})
})

describe('resolveReliableDownloadUrl', () => {
	it('reconstructs a branch archive URL via codeload.github.com', () => {
		expect(
			resolveReliableDownloadUrl('https://github.com/owner/repo/archive/refs/heads/main.zip'),
		).toBe('https://codeload.github.com/owner/repo/zip/refs/heads/main')
	})

	it('leaves a "latest release" asset URL as-is', () => {
		const url = 'https://github.com/owner/repo/releases/latest/download/Mod.zip'
		expect(resolveReliableDownloadUrl(url)).toBe(url)
	})

	it('leaves a tagged release asset URL as-is', () => {
		const url = 'https://github.com/owner/repo/releases/download/v1.0.0/Mod.zip'
		expect(resolveReliableDownloadUrl(url)).toBe(url)
	})

	it('reconstructs a refs/tags archive URL via codeload.github.com', () => {
		expect(
			resolveReliableDownloadUrl('https://github.com/owner/repo/archive/refs/tags/v1.0.0.zip'),
		).toBe('https://codeload.github.com/owner/repo/zip/refs/tags/v1.0.0')
	})

	it('reconstructs a legacy (no refs/) tag archive URL via codeload.github.com', () => {
		expect(resolveReliableDownloadUrl('https://github.com/owner/repo/archive/v1.0.0.zip')).toBe(
			'https://codeload.github.com/owner/repo/zip/refs/tags/v1.0.0',
		)
	})

	it('leaves an already-normalized codeload tag URL as-is', () => {
		const url = 'https://codeload.github.com/owner/repo/zip/refs/tags/v1.0.0'
		expect(resolveReliableDownloadUrl(url)).toBe(url)
	})

	it('leaves a Custom URL (GitLab) as-is', () => {
		const url = 'https://gitlab.com/owner/repo/-/archive/master/repo-master.zip?ref_type=heads'
		expect(resolveReliableDownloadUrl(url)).toBe(url)
	})
})
