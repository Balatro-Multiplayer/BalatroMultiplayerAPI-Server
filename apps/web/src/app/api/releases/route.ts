import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { branches, releases } from '@/server/db/schema'

export async function GET() {
  const res = await db
    .select({
      id: releases.id,
      name: releases.name,
      description: releases.description,
      version: releases.version,
      url: releases.url,
      smods_version: releases.smods_version,
      lovely_version: releases.lovely_version,
      branchId: releases.branchId,
      branchName: branches.name,
      createdAt: releases.createdAt,
      updatedAt: releases.updatedAt,
    })
    .from(releases)
    .leftJoin(branches, eq(releases.branchId, branches.id))

  return Response.json(res)
}
