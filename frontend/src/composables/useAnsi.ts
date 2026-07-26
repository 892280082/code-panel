// ── ANSI escape code → HTML (zero-dependency) ────────────
//    Three modes: strip | raw | color

const ANSI_FG: Record<number, string> = {
  30:'black',31:'red',32:'green',33:'yellow',34:'blue',35:'magenta',36:'cyan',37:'white',
  90:'bright-black',91:'bright-red',92:'bright-green',93:'bright-yellow',
  94:'bright-blue',95:'bright-magenta',96:'bright-cyan',97:'bright-white',
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export function ansiToHtml(s: string): string {
  let out = '', cls: string[] = [], i = 0
  while (i < s.length) {
    if (s[i] === '\x1b' && s[i+1] === '[') {
      const end = s.indexOf('m', i)
      if (end === -1) { out += escHtml(s[i]); i++; continue }
      const code = s.slice(i+2, end)
      if (code === '0' || code === '') { cls = [] }
      else {
        code.split(';').forEach(c => {
          const n = parseInt(c)
          if (ANSI_FG[n]) cls = cls.filter(x => !x.includes('-fg')).concat('ansi-'+ANSI_FG[n]+'-fg')
          else if (n === 1) cls.push('ansi-bold')
          else if (n === 2) cls.push('ansi-dim')
          else if (n === 3) cls.push('ansi-italic')
          else if (n === 4) cls.push('ansi-underline')
        })
      }
      i = end + 1
    } else {
      if (cls.length) out += '<span class="'+cls.join(' ')+'">'
      const start = i
      while (i < s.length && s[i] !== '\x1b') i++
      out += escHtml(s.slice(start, i))
      if (cls.length) out += '</span>'
    }
  }
  return out
}

export function ansiStrip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}
