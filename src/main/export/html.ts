export interface HtmlExportSnapshot {
  content: string
  html: string
  styles: string
  bodyClass: string
  background: string
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char)
}

export function buildHTMLDocument(snapshot: HtmlExportSnapshot, input: { title: string; locale: string }): string {
  const title = escapeHTML(input.title)
  const bodyClass = escapeHTML(snapshot.bodyClass)
  const renderedContent = snapshot.html || `<pre>${escapeHTML(snapshot.content)}</pre>`
  return `<!doctype html>
<html lang="${input.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${snapshot.styles || ''}
    html, body { height: auto; overflow: visible; }
    body { min-width: 320px; }
    #titlebar, #file-panel, #source-editor { display: none !important; }
    #editor { height: auto !important; min-height: 100vh; overflow: visible !important; padding: 40px !important; }
  </style>
</head>
<body class="${bodyClass}">
  <div id="editor"><div class="ProseMirror">${renderedContent}</div></div>
</body>
</html>
`
}

export async function exportHTML(path: string, snapshot: HtmlExportSnapshot, input: {
  title: string
  locale: string
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<unknown>
  showItemInFolder(path: string): void
}): Promise<boolean> {
  try {
    await input.writeFile(path, buildHTMLDocument(snapshot, input), 'utf-8')
    input.showItemInFolder(path)
    return true
  } catch {
    return false
  }
}
