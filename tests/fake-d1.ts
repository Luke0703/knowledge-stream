import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

/** Local SQLite adapter for repository integration tests (SPEC section 7). */
export function createFakeD1(seedSql?: string): D1Database {
  const db = new DatabaseSync(':memory:')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(migrations).sort()) {
    db.exec(readFileSync(new URL(file, migrations), 'utf8'))
  }
  if (seedSql) db.exec(seedSql)
  function prepare(sql: string) {
    function bound(params: unknown[] = []) {
      const statement = db.prepare(sql)
      return {
        bind: (...values: unknown[]) => bound(values),
        async all() { return { results: statement.all(...params as never[]) } },
        async first() { return statement.get(...params as never[]) ?? null },
        async run() { return { meta: { changes: Number(statement.run(...params as never[]).changes) } } },
      }
    }
    return bound()
  }
  return {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  } as unknown as D1Database
}
