import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './index.js'

async function main() {
	console.log('[migrate] Running migrations...')
	await migrate(db, { migrationsFolder: './drizzle' })
	console.log('[migrate] Migrations complete.')
	process.exit(0)
}

main().catch((err) => {
	console.error('[migrate] Migration failed:', err)
	process.exit(1)
})
