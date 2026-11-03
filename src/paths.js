/** Physical workspace confinement for user input and plugin-owned evidence. */
import { realpath, stat, mkdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path'

const inside = (root, path) => { const r = relative(root, path); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)) }

/** Resolve symlinks, including the existing parent of a not-yet-created output. */
export async function workspacePath(root, path, { existing = false, roots = [] } = {}) {
  root = await realpath(root)
  const target = resolve(root, path)
  let physical
  if (existing) physical = await realpath(target)
  else {
    let ancestor = target
    const tail = []
    while (true) {
      try { physical = resolve(await realpath(ancestor), ...tail.reverse()); break }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (dirname(ancestor) === ancestor) throw error
        tail.push(relative(dirname(ancestor), ancestor)); ancestor = dirname(ancestor)
      }
    }
  }
  const allowed = [root, ...await Promise.all(roots.map(p => realpath(p)))]
  if (!allowed.some(base => inside(base, physical))) throw new Error('路径超出当前工作文件夹；请先复制用户指定文件到工作文件夹，或由用户配置 additionalInputRoots。')
  return physical
}

/** Create a plugin-owned subdirectory only; never use an input path as a write target. */
export async function outputDirectory(root, path) {
  const directory = await workspacePath(root, path)
  if (directory === await realpath(root)) throw new Error('成果目录不能是工作文件夹根目录')
  await mkdir(directory, { recursive: true })
  return workspacePath(root, directory, { existing: true })
}

export async function inputFile(root, path, roots = []) {
  const file = await workspacePath(root, path, { existing: true, roots })
  if (!(await stat(file)).isFile()) throw new Error('请选择一个文件，不是文件夹')
  return file
}
