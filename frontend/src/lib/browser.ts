/** Browser-only platform helpers. */

export async function shareText(opts: {
  title: string
  text: string
  filename: string
}): Promise<'web-share' | 'download'> {
  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text })
      return 'web-share'
    } catch {
      // A dismissed or unsupported share sheet falls through to a download.
    }
  }

  const blob = new Blob([opts.text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = opts.filename
  anchor.click()
  URL.revokeObjectURL(url)
  return 'download'
}

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener')
}
