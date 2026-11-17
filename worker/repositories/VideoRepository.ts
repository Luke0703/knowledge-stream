import type { AdminVideoDto, AdminVideoUpdateRequest } from '../../shared/api'

export interface SearchedVideo {
  id: string
  platform: string
  externalVideoId: string
  label: string
  categories: string[]
}

interface VideoRow {
  id: string
  platform: string
  external_video_id: string
  label: string
}

interface CategoryNameRow {
  video_id: string
  name: string
}

// SPEC section 2.4: partial match over our own label, search_keywords and
// genre names, restricted to enabled videos. The pattern is always a bound
// value (never interpolated) and uses ESCAPE '\' together with
// escapeLikePattern, so `%`/`_` in user input match literally.
const SEARCH_SQL = `
SELECT v.id, v.platform, v.external_video_id, v.label
FROM videos v
WHERE v.enabled = 1
  AND (
    v.label LIKE ?1 ESCAPE '\\'
    OR v.search_keywords LIKE ?1 ESCAPE '\\'
    OR EXISTS (
      SELECT 1
      FROM video_categories vc
      JOIN categories c ON c.id = vc.category_id
      WHERE vc.video_id = v.id
        AND c.enabled = 1
        AND c.name LIKE ?1 ESCAPE '\\'
    )
  )
ORDER BY v.created_at ASC, v.id ASC
LIMIT ?2
`

/**
 * Thin repository: all SQL for videos lives here (SPEC section 7).
 * Callers pass already-validated filters and result limits.
 */
export class VideoRepository {
  constructor(private readonly db: D1Database) {}

  /** Admin reads include disabled videos and every genre link (SPEC sections 4 and 6). */
  async listAdminVideos(): Promise<AdminVideoDto[]> {
    return this.readAdminVideos()
  }

  async findAdminVideoById(id: string): Promise<AdminVideoDto | null> {
    return (await this.readAdminVideos(id))[0] ?? null
  }

  private async readAdminVideos(id?: string): Promise<AdminVideoDto[]> {
    const { results } = await this.db.prepare(`
      SELECT id, platform, external_video_id AS externalVideoId, label,
        search_keywords AS searchKeywords, enabled, availability_status AS availabilityStatus,
        created_at AS createdAt, updated_at AS updatedAt
      FROM videos ${id === undefined ? '' : 'WHERE id = ?'} ORDER BY created_at ASC, id ASC
    `).bind(...(id === undefined ? [] : [id])).all<Omit<AdminVideoDto, 'categoryIds' | 'enabled'> & { enabled: number }>()
    if (!results.length) return []
    const { results: links } = await this.db.prepare(`
      SELECT video_id, category_id FROM video_categories
      WHERE video_id IN (${results.map(() => '?').join(', ')}) ORDER BY category_id ASC
    `).bind(...results.map(row => row.id)).all<{ video_id: string; category_id: string }>()
    return results.map(row => ({ ...row, enabled: row.enabled === 1,
      categoryIds: links.filter(link => link.video_id === row.id).map(link => link.category_id) }))
  }

  async createVideo(row: Omit<AdminVideoDto, 'platform'>): Promise<void> {
    await this.db.batch([
      this.db.prepare(`INSERT INTO videos
        (id, platform, external_video_id, label, search_keywords, enabled, availability_status, created_at, updated_at)
        VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.id, row.externalVideoId, row.label, row.searchKeywords, Number(row.enabled), row.availabilityStatus, row.createdAt, row.updatedAt),
      ...row.categoryIds.map(categoryId => this.db.prepare(
        'INSERT INTO video_categories (video_id, category_id) VALUES (?, ?)',
      ).bind(row.id, categoryId)),
    ])
  }

  async updateVideo(id: string, fields: Omit<AdminVideoUpdateRequest, 'categoryIds'> & { updatedAt: string }, categoryIds: string[] | undefined): Promise<boolean> {
    const columns = { label: 'label', searchKeywords: 'search_keywords', enabled: 'enabled', availabilityStatus: 'availability_status', updatedAt: 'updated_at' } as const
    const keys = (Object.keys(columns) as (keyof typeof columns)[]).filter(key => fields[key] !== undefined)
    const statements = [this.db.prepare(`UPDATE videos SET ${keys.map(key => `${columns[key]} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map(key => key === 'enabled' ? Number(fields[key]) : fields[key]), id)]
    if (categoryIds !== undefined) {
      statements.push(this.db.prepare('DELETE FROM video_categories WHERE video_id = ?').bind(id))
      statements.push(...categoryIds.map(categoryId => this.db.prepare(
        'INSERT INTO video_categories (video_id, category_id) VALUES (?, ?)',
      ).bind(id, categoryId)))
    }
    const results = await this.db.batch(statements)
    return results[0].meta.changes > 0
  }

  async existsEnabledVideo(id: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 FROM videos WHERE id = ? AND enabled = 1 LIMIT 1')
      .bind(id)
      .first()
    return row !== null
  }

  async searchEnabledVideos(pattern: string, limit: number): Promise<SearchedVideo[]> {
    const { results } = await this.db
      .prepare(SEARCH_SQL)
      .bind(pattern, limit)
      .all<VideoRow>()
    return this.attachCategoryNames(results)
  }

  async listFeedVideos(categoryIds: string[], limit: number): Promise<SearchedVideo[]> {
    // SPEC section 3: selected genres use OR semantics. Only placeholder
    // syntax is interpolated; every category id and the limit are bound.
    const placeholders = categoryIds.map(() => '?').join(', ')
    const categoryFilter = categoryIds.length === 0 ? '' : `
  AND EXISTS (
    SELECT 1
    FROM video_categories vc
    JOIN categories c ON c.id = vc.category_id
    WHERE vc.video_id = v.id
      AND c.enabled = 1
      AND vc.category_id IN (${placeholders})
  )`
    const { results } = await this.db
      .prepare(`
SELECT v.id, v.platform, v.external_video_id, v.label
FROM videos v
WHERE v.enabled = 1${categoryFilter}
ORDER BY v.created_at ASC, v.id ASC
LIMIT ?
`)
      .bind(...categoryIds, limit)
      .all<VideoRow>()
    return this.attachCategoryNames(results)
  }

  private async attachCategoryNames(results: VideoRow[]): Promise<SearchedVideo[]> {
    if (results.length === 0) return []

    const ids = results.map(row => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    const { results: categoryRows } = await this.db
      .prepare(
        `SELECT vc.video_id AS video_id, c.name AS name
         FROM video_categories vc
         JOIN categories c ON c.id = vc.category_id
         WHERE c.enabled = 1 AND vc.video_id IN (${placeholders})
         ORDER BY c.name ASC`,
      )
      .bind(...ids)
      .all<CategoryNameRow>()

    const categoriesByVideo = new Map<string, string[]>()
    for (const row of categoryRows) {
      const names = categoriesByVideo.get(row.video_id) ?? []
      names.push(row.name)
      categoriesByVideo.set(row.video_id, names)
    }
    return results.map(row => ({
      id: row.id,
      platform: row.platform,
      externalVideoId: row.external_video_id,
      label: row.label,
      categories: categoriesByVideo.get(row.id) ?? [],
    }))
  }
}
