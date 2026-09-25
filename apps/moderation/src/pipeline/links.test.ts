import { describe, expect, it } from 'vitest'
import { LINK_PLACEHOLDER, parseApprovedDomains, stripLinks } from './links.js'

const APPROVED = parseApprovedDomains('# ok\nyoutube.com\ntenor.com\n')

describe('parseApprovedDomains', () => {
	it('parses hosts, skipping comments/blanks, stripping scheme/www/path', () => {
		expect(
			parseApprovedDomains(
				'# domains\nyoutube.com\n\nhttps://www.tenor.com/view\n',
			),
		).toEqual(['youtube.com', 'tenor.com'])
	})
})

describe('stripLinks', () => {
	it('removes an unapproved link, keeping surrounding text', () => {
		expect(stripLinks('check this https://evil.example/x lol', APPROVED)).toBe(
			`check this ${LINK_PLACEHOLDER} lol`,
		)
	})

	it('strips a bare gif url that is the whole message', () => {
		expect(
			stripLinks('https://tenor.com/view/cat-gif', parseApprovedDomains('')),
		).toBe(LINK_PLACEHOLDER)
	})

	it('keeps approved domains and their subdomains', () => {
		expect(stripLinks('https://www.youtube.com/watch?v=abc', APPROVED)).toBe(
			'https://www.youtube.com/watch?v=abc',
		)
		expect(stripLinks('https://tenor.com/view/x', APPROVED)).toBe(
			'https://tenor.com/view/x',
		)
	})

	it('handles a mix of approved and unapproved links independently', () => {
		expect(
			stripLinks('a https://tenor.com/g and https://spam.co/x', APPROVED),
		).toBe(`a https://tenor.com/g and ${LINK_PLACEHOLDER}`)
	})

	it('matches www. links without a scheme', () => {
		expect(stripLinks('go to www.spam.co now', APPROVED)).toBe(
			`go to ${LINK_PLACEHOLDER} now`,
		)
	})

	it('leaves link-free messages untouched (no false positives on slang)', () => {
		expect(stripLinks('gg wp ez', APPROVED)).toBe('gg wp ez')
		expect(stripLinks('good game 1.5.2 patch', APPROVED)).toBe(
			'good game 1.5.2 patch',
		)
	})
})
