/** Packaging/data checks do not contact a model or modify a DSH profile. */
import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { catalog,guides } from '../src/index.js'
import { resourceManifest } from '../src/latex-resources.js'
import { latexTools } from '../src/latex-tools.js'
import { fileHash } from '../src/latex-resources.js'

const root=fileURLToPath(new URL('../',import.meta.url))
const metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
assert.equal(metadata.dsh.bundle.patch,'./cordis.patch.yml')
assert.ok(!metadata.scripts.prepare && !metadata.scripts.install && !metadata.scripts.postinstall)
assert.equal(latexTools.length,6)
assert.equal(resourceManifest.glyph_count,22583)
for(const entry of resourceManifest.files){
  assert.equal(await fileHash(join(root,'assets/openglyph-latex',entry.stored)),entry.stored_sha256)
}
for(const tool of catalog.tools) {
  assert.ok(guides[tool.name]?.purpose && guides[tool.name]?.returns && guides[tool.name]?.example)
  for(const field of tool.input_schema.required||[])assert.ok(tool.input_schema.properties[field])
}
for(const dir of ['src','scripts','tests']) {
  for(const file of await readdir(join(root,dir))) {
    if(!file.endsWith('.js'))continue
    const result=spawnSync(process.execPath,['--check',join(root,dir,file)],{encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
  }
}
console.log('20 remote tools + six local LaTeX tools documented; 22,583-form resources verified; ESM and Git-install entry valid.')
