import type { AdminCategoryDto, AdminCategoryUpdateRequest } from '../../shared/api'

interface CategoryRow {
  id: string
  name: string
}

const LIST_SQL = `
SELECT id, name
FROM categories
WHERE enabled = 1
ORDER BY name ASC, id ASC
`

/** Thin repository: all SQL for categories lives here (SPEC section 7). */
export class CategoryRepository {
  constructor(private readonly db: D1Database) {}

  /** Admin includes disabled genres (SPEC section 6). */
  async listAdminCategories(): Promise<AdminCategoryDto[]> {
    const { results } = await this.db.prepare(`SELECT id, name, enabled,
      created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY name ASC, id ASC`)
      .bind().all<Omit<AdminCategoryDto, 'enabled'> & { enabled: number }>()
    return results.map(row => ({ ...row, enabled: row.enabled === 1 }))
  }

  async findAdminCategoryById(id: string): Promise<AdminCategoryDto | null> {
    const row = await this.db.prepare(`SELECT id, name, enabled,
      created_at AS createdAt, updated_at AS updatedAt FROM categories WHERE id = ?`)
      .bind(id).first<Omit<AdminCategoryDto, 'enabled'> & { enabled: number }>()
    return row ? { ...row, enabled: row.enabled === 1 } : null
  }

  async createCategory(row: AdminCategoryDto): Promise<void> {
    await this.db.prepare('INSERT INTO categories (id, name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, row.name, Number(row.enabled), row.createdAt, row.updatedAt).run()
  }

  async updateCategory(id: string, fields: AdminCategoryUpdateRequest & { updatedAt: string }): Promise<boolean> {
    const columns = { name: 'name', enabled: 'enabled', updatedAt: 'updated_at' } as const
    const keys = (Object.keys(columns) as (keyof typeof columns)[]).filter(key => fields[key] !== undefined)
    const result = await this.db.prepare(`UPDATE categories SET ${keys.map(key => `${columns[key]} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map(key => key === 'enabled' ? Number(fields[key]) : fields[key]), id).run()
    return result.meta.changes > 0
  }

  async existingCategoryIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return []
    const { results } = await this.db.prepare(`SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids).all<{ id: string }>()
    return results.map(row => row.id)
  }

  async listEnabledCategories(): Promise<{ id: string; name: string }[]> {
    const { results } = await this.db
      .prepare(LIST_SQL)
      .bind()
      .all<CategoryRow>()
    return results.map(row => ({ id: row.id, name: row.name }))
  }
}
