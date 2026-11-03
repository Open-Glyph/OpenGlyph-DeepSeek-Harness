/** Install a packed artifact into an isolated consumer; no real model/profile. */
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve,join,dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const artifact=resolve(process.argv[2]||'')
assert.ok(artifact.endsWith('.tgz'),'provide packed .tgz artifact')
const directory=await mkdtemp(join(tmpdir(),'openglyph-package-consumer-'))
try{
  await writeFile(join(directory,'package.json'),JSON.stringify({private:true,type:'module'}))
  const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/KEY|PASSWORD|SECRET|TOKEN/i.test(k)))
  environment.PATH=dirname(process.execPath)+':'+process.env.PATH
  const install=spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',artifact],{cwd:directory,encoding:'utf8',env:environment})
  assert.equal(install.status,0,install.stderr)
  const script=`
    import assert from 'node:assert/strict';
    import {Context,Service} from '@deepseek-ai/cordis';
    import Prompt from '@deepseek-ai/dsh-system-prompt';
    import Tools from '@deepseek-ai/dsh-tools';
    import Skills from '@deepseek-ai/dsh-skill';
    import * as plugin from '@openglyph/dsh-openglyph';
    const ctx=new Context();
    await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(Skills);
    class Inputs extends Service {constructor(ctx){super(ctx,'subprocess')}}
    class Attachments extends Service {constructor(ctx){super(ctx,'attachments')}}
    class WorkingDirectory extends Service {constructor(ctx){super(ctx,'workingDirectory')}}
    class Shell extends Service {constructor(ctx){super(ctx,'shell')}}
    await ctx.plugin(Inputs);await ctx.plugin(Shell);await ctx.plugin(Attachments);await ctx.plugin(WorkingDirectory);
    await ctx.plugin(plugin, {workspaceRoot:process.cwd()});
    assert.equal(ctx.tools.schemas().filter(t=>t.name.startsWith('gwz_')).length,33);
    const skill=await ctx.skills.get('openglyph');
    assert.equal(skill.invocation.userInvocable,true);
    assert.match(skill.content,/OpenGlyphLoad/);
    assert.ok(ctx.tools.get('gwz_glyph_compose').parameters.properties.program);
    await ctx.fiber.dispose();
    console.log(JSON.stringify({status:'passed',registered:33,slash_skill:'openglyph',entry:'packed Git-install-compatible ESM',model_calls:0}));
  `
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:directory,encoding:'utf8',env:environment})
  assert.equal(result.status,0,result.stderr)
  const bytes=await readFile(artifact)
  console.log(JSON.stringify({...JSON.parse(result.stdout.trim()),artifact,artifact_sha256:createHash('sha256').update(bytes).digest('hex')}))
}finally{
  await rm(directory,{recursive:true,force:true})
}
