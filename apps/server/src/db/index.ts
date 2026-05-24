import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.js'
import * as schema from './schema.js'

export const pool = new pg.Pool({
	connectionString: env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
