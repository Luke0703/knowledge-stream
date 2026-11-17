import type { AdminFeedbackDto, FeedbackType } from '../../shared/api'

/** Thin repository: all feedback SQL lives here (SPEC sections 5 and 7). */
export class FeedbackRepository {
  constructor(private readonly db: D1Database) {}

  /** SPEC section 6: review anonymous feedback without exposing client hashes. */
  async listRecentForAdmin(limit: number, feedbackType: FeedbackType | undefined): Promise<AdminFeedbackDto[]> {
    const { results } = await this.db.prepare(`SELECT f.id, f.video_id AS videoId,
      v.label AS videoLabel, f.feedback_type AS feedbackType, f.created_at AS createdAt
      FROM feedback f JOIN videos v ON v.id = f.video_id
      ${feedbackType === undefined ? '' : 'WHERE f.feedback_type = ?'}
      ORDER BY f.created_at DESC, f.id DESC LIMIT ?`)
      .bind(...(feedbackType === undefined ? [] : [feedbackType]), limit).all<AdminFeedbackDto>()
    return results
  }

  async exists(videoId: string, clientHash: string, feedbackType: FeedbackType): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 FROM feedback WHERE video_id = ? AND client_hash = ? AND feedback_type = ? LIMIT 1')
      .bind(videoId, clientHash, feedbackType)
      .first()
    return row !== null
  }

  async countSince(clientHash: string, sinceIso: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS count FROM feedback WHERE client_hash = ? AND created_at >= ?')
      .bind(clientHash, sinceIso)
      .first<{ count: number }>()
    return row?.count ?? 0
  }

  async insertIgnore(row: {
    id: string
    videoId: string
    clientHash: string
    feedbackType: FeedbackType
    createdAt: string
  }): Promise<boolean> {
    const result = await this.db
      .prepare('INSERT OR IGNORE INTO feedback (id, video_id, client_hash, feedback_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, row.videoId, row.clientHash, row.feedbackType, row.createdAt)
      .run()
    return result.meta.changes > 0
  }
}
