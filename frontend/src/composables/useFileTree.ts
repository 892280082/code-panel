// ── 文件层级树 composable(公共前缀压缩,GitView 侧栏 / 弹窗可共用)────
//   输入文件列表(path 唯一)→ 压缩树:单孩子目录链合并、显示名取链的最后
//   一级(公共深链直接跳过,根从分叉处开始);提供展开/折叠与扁平可见行。

import { computed, ref, watch, type Ref } from 'vue'

export interface FileTreeNode<T> {
  key: string          // 目录 = 压缩链全路径;文件 = path
  name: string         // 显示名(目录 = 链的最后一级;文件 = 文件名)
  fullName: string     // 完整路径(hover 提示)
  path: string         // 同 fullName(文件 = 真实 path)
  dir: boolean
  depth?: number
  item?: T             // 文件节点挂原始数据
  children?: FileTreeNode<T>[]
}

export interface FileTreeRow<T> {
  type: 'dir' | 'file'
  node: FileTreeNode<T>
  depth: number
}

export function useFileTree<T extends { path: string }>(files: Ref<T[]>) {
  const expandedDirs = ref<Set<string>>(new Set())

  const tree = computed<FileTreeNode<T>[]>(() => {
    const list = files.value
    if (!list.length) return []

    // 原始树:目录 Map + 文件叶子(叶子 key 加 ·f 防与同名目录撞)
    type Raw = { name: string; children: Map<string, Raw>; file?: T }
    const root: Raw = { name: '', children: new Map() }
    for (const f of list) {
      const parts = f.path.split('/')
      let cur = root
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]
        if (!cur.children.has(p)) cur.children.set(p, { name: p, children: new Map() })
        cur = cur.children.get(p)!
      }
      const leaf = parts[parts.length - 1]
      cur.children.set(leaf + '·f', { name: leaf, children: new Map(), file: f })
    }

    // 压缩:单孩子目录链合并为单节点;显示名 = 链的最后一级
    const convert = (raw: Raw, prefix: string): FileTreeNode<T>[] => {
      const out: FileTreeNode<T>[] = []
      for (const [, node] of raw.children) {
        if (node.file) {
          const base = prefix ? prefix + '/' + node.name : node.name
          out.push({ key: base, name: node.name, fullName: base, path: base, dir: false, item: node.file })
          continue
        }
        let name = node.name
        let full = prefix ? prefix + '/' + name : name
        let children = node.children
        while (children.size === 1) {
          const only = [...children.values()][0]
          if (only.file) break
          const k = [...children.keys()][0]
          name = k
          full = full + '/' + k
          children = only.children
        }
        out.push({ key: full, name, fullName: full, path: full, dir: true, children: convert({ name, children }, full) })
      }
      return out
    }
    const t = convert(root, '')

    // 排序:目录在前、字母序
    const sortRec = (nodes: FileTreeNode<T>[]) => {
      nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      nodes.forEach(n => n.children && sortRec(n.children))
    }
    sortRec(t)
    return t
  })

  // diffResult/files 变化 → 默认全展开
  watch(files, () => {
    const all: string[] = []
    const walk = (nodes: FileTreeNode<T>[]) => nodes.forEach(n => {
      if (n.dir) { all.push(n.key); walk(n.children!) }
    })
    walk(tree.value)
    expandedDirs.value = new Set(all)
  })

  const visibleRows = computed<FileTreeRow<T>[]>(() => {
    const rows: FileTreeRow<T>[] = []
    const walk = (nodes: FileTreeNode<T>[], depth: number) => {
      for (const n of nodes) {
        if (n.dir) {
          rows.push({ type: 'dir', node: n, depth })
          if (expandedDirs.value.has(n.key)) walk(n.children!, depth + 1)
        } else {
          rows.push({ type: 'file', node: n, depth })
        }
      }
    }
    walk(tree.value, 0)
    return rows
  })

  function toggleDir(key: string): void {
    const next = new Set(expandedDirs.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedDirs.value = next
  }

  return { tree, visibleRows, expandedDirs, toggleDir }
}
