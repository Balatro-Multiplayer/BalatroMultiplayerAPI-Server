import { describe, expect, it } from 'vitest'
import {
	legacySteamoddedTag,
	withLegacySteamoddedTags,
} from '../../features/mods/legacy-steamodded-tags.js'

describe('legacySteamoddedTag', () => {
	it('maps Thunderstore builds back to the GitHub tag', () => {
		expect(legacySteamoddedTag('1.1620.0')).toBe('1.0.0-beta-1620a')
		expect(legacySteamoddedTag('1.1606.1')).toBe('1.0.0-beta-1606b')
		expect(legacySteamoddedTag('1.1814.0')).toBe('1.0.0-beta-1814a')
	})

	it('leaves versions that are not builds alone', () => {
		expect(legacySteamoddedTag('26.829.0')).toBeNull()
		expect(legacySteamoddedTag('0.9.8')).toBeNull()
		expect(legacySteamoddedTag('1.1531.999999')).toBeNull()
	})
})

describe('withLegacySteamoddedTags', () => {
	const versions = [
		{ version: '26.829.0', sha256: null },
		{ version: '1.1620.0', sha256: 'abc' },
	]

	it('appends twins after the real versions, keeping the hash', () => {
		expect(withLegacySteamoddedTags('Steamodded-Steamodded', versions)).toEqual(
			[...versions, { version: '1.0.0-beta-1620a', sha256: 'abc' }],
		)
	})

	it('does nothing for other mods', () => {
		expect(withLegacySteamoddedTags('Someone-Else', versions)).toBe(versions)
		expect(withLegacySteamoddedTags(null, versions)).toBe(versions)
	})
})
