export function orderFeedVideos<T extends { id: string }>(
  videos: readonly T[],
  options: { viewedIds: ReadonlySet<string>; notInterestedIds: ReadonlySet<string>; random?: () => number },
): T[] {
  const unviewed: T[] = []
  const viewed: T[] = []
  const random = options.random ?? Math.random
  for (const video of videos) {
    if (options.notInterestedIds.has(video.id)) continue
    ;(options.viewedIds.has(video.id) ? viewed : unviewed).push(video)
  }
  for (const partition of [unviewed, viewed]) {
    for (let i = partition.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[partition[i], partition[j]] = [partition[j], partition[i]]
    }
  }
  return [...unviewed, ...viewed]
}
