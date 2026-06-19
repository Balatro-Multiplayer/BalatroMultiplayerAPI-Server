import { describe, expect, test } from 'bun:test'
import {
  formatWarningGameContextLines,
  parseWarningGameContext,
} from '@/server/services/warning-context'

describe('warning context', () => {
  test('keeps ante 1 details and first 12 queue entries', () => {
    const context = parseWarningGameContext({
      antes: [
        {
          n: 2,
          boss: 'The Wall',
        },
        {
          n: 1,
          boss: 'The Window',
          voucher: 'Clearance Sale',
          tags: ['Economy Tag', 'Speed Tag'],
          packs: ['Buffoon Pack', 'Spectral Pack - Aura, Trance'],
        },
      ],
      shopQueue: [
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
        '13',
      ],
    })

    expect(context).toEqual({
      firstAnte: {
        n: 1,
        boss: 'The Window',
        voucher: 'Clearance Sale',
        tags: ['Economy Tag', 'Speed Tag'],
        packs: ['Buffoon Pack', 'Spectral Pack - Aura, Trance'],
      },
      shopQueuePreview: [
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
      ],
    })
  })

  test('formats compact warning lines', () => {
    const lines = formatWarningGameContextLines({
      firstAnte: {
        n: 1,
        boss: 'The Window',
        voucher: 'Clearance Sale',
        tags: ['Economy Tag'],
        packs: ['Buffoon Pack'],
      },
      shopQueuePreview: ['Misprint', 'Ouija'],
    })

    expect(lines).toEqual([
      'Ante 1',
      '- Boss: The Window',
      '- Voucher: Clearance Sale',
      '- Tags: Economy Tag',
      '- Packs:',
      '  1. Buffoon Pack',
      'Shop queue',
      '  1. Misprint',
      '  2. Ouija',
    ])
  })
})
