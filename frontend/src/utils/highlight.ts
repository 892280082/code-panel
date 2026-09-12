// ── 语法高亮共享工具(highlight.js;FilePreview / GitView 共用)──────────
//   highlightLines:整段一次 highlight(保留跨行语法如块注释/模板字符串),
//   再按 \n 拆回每行 HTML,供 diff 行渲染。

import hljs from 'highlight.js'

const extToLang: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'xml',
  '.html': 'xml', '.htm': 'xml',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini',
  '.md': 'markdown', '.mdx': 'markdown',
  '.py': 'python', '.rb': 'ruby',
  '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.sql': 'sql', '.xml': 'xml', '.svg': 'xml',
  '.dockerfile': 'dockerfile', '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf', '.php': 'php', '.swift': 'swift', '.r': 'r',
}

function highlightCode(code: string, path: string): string {
  const ext = '.' + (path.split('.').pop() || '')
  const lang = extToLang[ext] || 'plaintext'
  try {
    return hljs.highlight(code, { language: lang }).value
  } catch {
    return hljs.highlightAuto(code).value
  }
}

/** 按行高亮:入力行数组 → 每行 HTML(与输入等长;超大文件跳过高亮保持纯文本) */
export function highlightLines(lines: string[], path: string): string[] {
  if (lines.length > 5000) return lines
  const html = highlightCode(lines.join('\n'), path)
  const out = html.split('\n')
  while (out.length < lines.length) out.push('')
  return out.slice(0, lines.length)
}
