/** Package only the public, pinned OpenGlyph-LaTeX runtime and its licenses. */
import { readFile,writeFile,readdir,mkdir,copyFile } from 'node:fs/promises'
import { resolve,join,relative,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gzipSync,gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

const root=fileURLToPath(new URL('../',import.meta.url))
const source=resolve(process.argv[2]||join(root,'../OpenGlyph-LaTeX'))
const destination=join(root,'assets/openglyph-latex')
const commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
const dirty=execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim()
if(dirty)throw new Error('Commit the LaTeX source before staging its pinned runtime')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const paths=['openglyph.sty','LICENSE','THIRD-PARTY-NOTICES.md','requirements-build.txt','README.md',
  'ebag/OpenGlyphEbag.otf','ebag/catalog.tex','ebag/manifest.json',
  'data/glyphwiki-ebag.kage.jsonl.gz','data/provenance.json',
  'scripts/openglyph.py','examples/newforms.json','examples/modules.json',
  'licenses/GlyphWiki.txt','licenses/GlyphWiki-README.txt']
for(const directory of ['scripts/oglib','vendor/kage-engine']) {
  for(const name of await readdir(join(source,directory))) {
    if(name.endsWith('.py')||name.endsWith('.js')||name==='COPYING')paths.push(directory+'/'+name)
  }
}
const files=[]
for(const path of paths) {
  const bytes=await readFile(join(source,path))
  const compressed=['ebag/OpenGlyphEbag.otf','ebag/catalog.tex','ebag/manifest.json'].includes(path)
  const target=path+(compressed?'.gz':'')
  const output=join(destination,target)
  await mkdir(dirname(output),{recursive:true})
  let stored=compressed?gzipSync(bytes,{level:9}):bytes
  // Preserve an identical pinned font even across zlib versions.
  if(compressed){
    try{
      const existing=await readFile(output)
      if(gunzipSync(existing).equals(bytes))stored=existing
    }catch(error){if(error.code!=='ENOENT')throw error}
  }
  await writeFile(output,stored)
  files.push({path,stored:target,compression:compressed?'gzip':null,bytes:bytes.length,sha256:sha(bytes),stored_sha256:sha(stored)})
}
const metadata=JSON.parse(await readFile(join(source,'ebag/manifest.json'),'utf8'))
const manifest={schema:'openglyph.dsh.latex-resources.v1',source_repository:'https://github.com/Open-Glyph/OpenGlyph-LaTeX',
  source_commit:commit,source_version:(await readFile(join(source,'scripts/oglib/__init__.py'),'utf8')).match(/__version__\s*=\s*'([^']+)'/)[1],
  glyph_count:metadata.glyph_count,font_sha256:metadata.font_sha256,files}
await writeFile(join(destination,'resources.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({source_commit:commit,glyphs:metadata.glyph_count,files:files.length,stored_bytes:await Promise.all(files.map(f=>readFile(join(destination,f.stored)))).then(b=>b.reduce((n,x)=>n+x.length,0))}))
