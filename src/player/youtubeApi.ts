declare global {
  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}

let pending: Promise<typeof YT> | undefined

export function loadYouTubeApi(): Promise<typeof YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (pending) return pending
  pending = new Promise<typeof YT>((resolve, reject) => {
    const script = document.createElement('script')
    const previous = window.onYouTubeIframeAPIReady
    const cleanup = () => {
      clearTimeout(timeout)
      script.onerror = null
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous
    }
    const fail = () => {
      cleanup()
      script.remove()
      pending = undefined
      reject(new Error('YouTube APIを読み込めません。通信やコンテンツブロッカーを確認してください。'))
    }
    const ready = () => {
      if (!window.YT?.Player) { fail(); return }
      cleanup()
      resolve(window.YT)
      previous?.()
    }
    const timeout = window.setTimeout(fail, 15_000)
    window.onYouTubeIframeAPIReady = ready
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = fail
    document.head.append(script)
  })
  return pending
}
