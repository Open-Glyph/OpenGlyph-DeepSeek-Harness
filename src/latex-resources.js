/** Checksummed, lazy extraction of the public bundled LaTeX library. */
import { createReadStream,createWriteStream } from 'node:fs'
import { readFile,mkdir,rename,unlink,stat } from 'node:fs/promises'
import { createHash,randomUUID } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { join,dirname,isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outputDirectory,workspacePath } from './paths.js'

const assetRoot=fileURLToPath(new URL('../assets/openglyph-latex/',import.meta.url))
const raw=await readFile(join(assetRoot,'resources.json'))
export const resourceManifest=JSON.parse(raw)
export const resourceKey=createHash('sha256').update(raw).digest('hex').slice(0,16)
const pending=new Map()

export async function fileHash(path) {
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(path))hash.update(chunk)
  return hash.digest('hex')
}

export async function materialize(cwd,config) {
  const root=await outputDirectory(cwd,join(config.latexRuntimeDirectory,'resources-'+resourceKey))
  if(pending.has(root)){
    const ready=await pending.get(root)
    for(const entry of resourceManifest.files){
      if(await fileHash(join(ready,entry.path))!==entry.sha256)throw new Error('本地资源在准备后被修改，未执行或覆盖：'+entry.path)
    }
    return ready
  }
  const work=(async()=>{
    for(const entry of resourceManifest.files) {
      if(isAbsolute(entry.path)||entry.path.includes('\\')||entry.path.split('/').includes('..'))throw new Error('字库资源路径非法')
      const target=await workspacePath(root,entry.path)
      let exists=true
      try{await stat(target)}catch(error){if(error.code==='ENOENT')exists=false;else throw error}
      if(exists){
        if(await fileHash(target)!==entry.sha256)throw new Error('本地排印资源已改变，未覆盖：'+target)
        continue
      }
      const source=join(assetRoot,entry.stored)
      if(await fileHash(source)!==entry.stored_sha256)throw new Error('插件随附字库校验失败：'+entry.path)
      await mkdir(dirname(target),{recursive:true})
      const temporary=target+'.'+randomUUID()+'.tmp'
      try{
        const streams=[createReadStream(source)]
        if(entry.compression==='gzip')streams.push(createGunzip())
        streams.push(createWriteStream(temporary,{flags:'wx',mode:0o600}))
        await pipeline(...streams)
        if(await fileHash(temporary)!==entry.sha256||(await stat(temporary)).size!==entry.bytes)throw new Error('展开字库后的校验失败：'+entry.path)
        await rename(temporary,target)
      }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
    }
    return root
  })()
  pending.set(root,work)
  try{return await work}catch(error){pending.delete(root);throw error}
}
