// @ts-nocheck
import { RANKED_QUEUE_ID } from '@/shared/constants'

const data = await fetch(
  `http://balatro.virtualized.dev:4931/api/stats/overall-history/${RANKED_QUEUE_ID}`
).then((res) => res.json())

const parsed_and_sorted = data.data.toSorted((a, b) => {
  return a.game_num - b.game_num
})

await Bun.write('./src/data.json', JSON.stringify(parsed_and_sorted, null, 2))
