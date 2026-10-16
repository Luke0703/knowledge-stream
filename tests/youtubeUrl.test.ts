import { describe, expect, it } from 'vitest'
import { extractYouTubeVideoId } from '../src/player/youtubeUrl'
import { testVideos, videoSources } from '../src/videos'

describe('YouTube source parsing', () => {
  it.each([
    'pgGrQjYcm5A', '  pgGrQjYcm5A  ',
    'https://www.youtube.com/shorts/pgGrQjYcm5A?si=share#fragment',
    'https://youtube.com/shorts/pgGrQjYcm5A/',
    'https://m.youtube.com/watch?v=pgGrQjYcm5A&t=10',
    'https://music.youtube.com/watch?v=pgGrQjYcm5A',
    'https://youtu.be/pgGrQjYcm5A?si=share',
    'https://www.youtube.com/embed/pgGrQjYcm5A',
    'https://www.youtube-nocookie.com/embed/pgGrQjYcm5A',
  ])('extracts an ID from %s', source => {
    expect(extractYouTubeVideoId(source)).toBe('pgGrQjYcm5A')
  })
  it.each([
    '', 'not-an-id', 'pgGrQjYcm5Aextra',
    'https://youtube.com.evil.example/shorts/pgGrQjYcm5A',
    'https://evil.example/?v=pgGrQjYcm5A',
    'https://youtube.com@evil.example/watch?v=pgGrQjYcm5A',
    'https://user:password@youtube.com/watch?v=pgGrQjYcm5A',
    'javascript:pgGrQjYcm5A', 'ftp://youtube.com/shorts/pgGrQjYcm5A',
    'https://youtube.com/playlist?list=pgGrQjYcm5A',
    'https://youtu.be/pgGrQjYcm5A/extra',
    'https://youtube.com/shorts/pgGrQjYcm5A/extra',
    'https://youtube.com/watch?v=too-short', 'https://youtube.com/watch',
  ])('rejects unsupported or misleading input %s', source => {
    expect(extractYouTubeVideoId(source)).toBeNull()
  })
  it('keeps three distinct valid fixtures and internal UUIDs separate from video IDs', () => {
    expect(testVideos).toHaveLength(3)
    expect(new Set(testVideos.map(v => v.externalVideoId)).size).toBe(3)
    for (const [index, video] of testVideos.entries()) {
      expect(video.externalVideoId).toBe(extractYouTubeVideoId(videoSources[index].source))
      expect(video.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })
})
