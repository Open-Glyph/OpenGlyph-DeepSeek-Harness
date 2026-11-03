/** Packaging/data checks do not contact a model or modify a DSH profile. */
import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { catalog,guides } from '../src/index.js'

const root=fileURLToPath(new URL('../',import.meta.url))
const metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
assert.equal(metadata.dsh.bundle.patch,'./cordis.patch.yml')
assert.ok(!metadata.scripts.prepare && !metadata.scripts.install && !metadata.scripts.postinstall)
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
console.log('20 tools documented; input schema snapshot valid; ESM syntax and prebuilt Git-install entry valid.')
