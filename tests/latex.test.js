import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp,writeFile,readFile,rm,access,cp } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,isAbsolute,dirname,delimiter } from 'node:path'
import { Context,Service } from '@deepseek-ai/cordis'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.js'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { Session,SessionId,SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import Agents,{ agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { shellQuote } from '../src/commands.js'

const python=process.env.GWZ_TEST_PYTHON||'python3'
const tectonic=process.env.GWZ_TEST_TECTONIC||'/opt/homebrew/bin/tectonic'
const haveTectonic=await access(tectonic,constants.X_OK).then(()=>true,()=>false)
const haveBuilder=Boolean(process.env.GWZ_TEST_PYTHON)

async function run(executable,args){
  const child=spawn(executable,args,{env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/KEY|PASSWORD|SECRET|TOKEN/i.test(k)))})
  let stdout='',stderr=''
  child.stdout.on('data',b=>{stdout+=b});child.stderr.on('data',b=>{stderr+=b})
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
  assert.equal(code,0,stderr||stdout)
  return stdout
}

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'openglyph-latex-test-'))
  if(process.env.GWZ_KEEP_TEST_OUTPUT)console.log(JSON.stringify({test_artifact_root:root}))
  const ctx=new Context()
  await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(Skills)
  class Process extends Service {
    constructor(context){super(context,'subprocess')}
    async resolveExecutable(command){
      const candidates=isAbsolute(command)?[command]:[dirname(process.execPath),...(process.env.PATH||'').split(delimiter),'/usr/bin','/opt/homebrew/bin'].map(d=>join(d,command))
      for(const path of candidates){try{await access(path,constants.X_OK);return path}catch(error){if(!['ENOENT','EACCES'].includes(error.code))throw error}}
      throw new Error('executable not found: '+command)
    }
  }
  class Shell extends Service {
    constructor(context){super(context,'shell');this.commands=[]}
    resolve(request){assert.equal(request.onExpiry,'none');return request}
    async execute(spec){
      this.commands.push(spec.command)
      const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/KEY|PASSWORD|SECRET|TOKEN/i.test(k)))
      const child=spawn('/bin/bash',['-c',spec.command],{cwd:spec.workdir,signal:spec.signal,env:{...env,...spec.env}})
      let stdout='',stderr=''
      child.stdout.on('data',b=>{stdout=(stdout+b).slice(-8000)})
      child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8000)})
      const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(exitCode,signal)=>resolve({exitCode,signal,stdout:{text:stdout},stderr:{text:stderr}}))})
      return {result:()=>done}
    }
  }
  class Attachments extends Service {
    constructor(context){super(context,'attachments')}
    async saveImage({data,mediaType,name}){return {id:'fixture-'+data.length,mediaType,name,bytes:data.length,width:960,height:520}}
  }
  class WorkingDirectory extends Service {
    constructor(context){super(context,'workingDirectory')}
    get(){return root}
    async ensure(){return root}
  }
  await ctx.plugin(Process);await ctx.plugin(Shell);await ctx.plugin(Attachments);await ctx.plugin(WorkingDirectory)
  await ctx.plugin(plugin,{workspaceRoot:root,python,tectonic,allowTexDownloads:false})
  let n=0
  const call=(name,args={})=>ctx.tools.execute({callId:ToolCallId('latex-'+(++n)),name,arguments:args,signal:new AbortController().signal})
  t.after(async()=>{await ctx.fiber.dispose();if(!process.env.GWZ_KEEP_TEST_OUTPUT)await rm(root,{recursive:true,force:true})})
  return {root,ctx,call}
}

test('primary /openglyph and legacy alias load the same complete macros and operations',async t=>{
  const {ctx}=await setup(t)
  const primary=await ctx.skills.get('openglyph'),legacy=await ctx.skills.get('openglyph-paleography')
  assert.equal(primary.invocation.userInvocable,true)
  assert.equal(primary.invocation.modelInvocable,true)
  assert.equal(primary.content,legacy.content)
  assert.match(primary.content,/\\OpenGlyphLoad\{ebag\}/)
  assert.match(primary.content,/gwz_latex_compile/)
  assert.ok(ctx.tools.get('gwz_latex_build'))
})

test('actual DSH /openglyph pre-step injects the full skill without a model request',async t=>{
  const {ctx,root}=await setup(t)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(Agents)
  await ctx.plugin(ToolSkill)
  const id=SessionId('openglyph-slash-test')
  const session=Session.create(id,[],{version:SESSION_FORMAT_VERSION,id,createdAt:0,cwd:root,isSeeded:false})
  const agent={id,ctx:new Context(),session,options:{},status:'idle',inject(){throw new Error('must not make an ad-hoc model injection')}}
  const messages=[createUserMessage({content:[{type:'text',text:'/openglyph 请排印论文并编译PDF'}],source:{kind:'user'}})]
  const decision=await agentEvents(ctx,agent).waterfall('agent/pre-step',
    {modelSelection:{provider:'keyless-test',model:'keyless-test'},messages,turn:1,step:1,signal:new AbortController().signal},
    ()=>Promise.resolve({kind:'enter',messages}))
  assert.equal(decision.kind,'enter')
  const loaded=decision.messages.find(m=>m.source.kind==='skill-invocation'&&m.source.name==='openglyph')
  assert.ok(loaded,'slash gesture must produce a durable skill-invocation message')
  assert.match(loaded.content[0].text,/OpenGlyphLoad/)
  assert.match(loaded.content[0].text,/gwz_latex_compile/)
  await agent.ctx.fiber.dispose()
})

test('bundle prepares a relocatable project, exact glyph lookup and no cloud login requirement',async t=>{
  const {root,call}=await setup(t)
  const prepared=await call('gwz_latex_prepare',{project_dir:'outputs/有空格 paper',title:'标题含 & % _ { }'})
  assert.equal(prepared.isError,false,JSON.stringify(prepared))
  const value=prepared.value
  const main=await readFile(value.tex_file,'utf8')
  assert.match(main,/\\OpenGlyphLoad\{ebag\}/)
  assert.match(main,/\\& \\% \\_ \\\{ \\\}/)
  const manifest=JSON.parse(await readFile(join(value.project_dir,'ebag/manifest.json'),'utf8'))
  assert.equal(manifest.glyph_count,22583)
  const found=await call('gwz_latex_lookup',{query:'s030-067'})
  assert.equal(found.isError,false)
  assert.equal(found.value.glyphs[0].latex,'\\ebag{s030-067}')
  const duplicate=await call('gwz_latex_prepare',{project_dir:'outputs/有空格 paper'})
  assert.equal(duplicate.isError,true)
  assert.equal(await readFile(value.tex_file,'utf8'),main)
})

test('prepared project compiles a real PDF with embedded glyph font, preserving previous PDF', {skip:!haveTectonic},async t=>{
  const {call,ctx}=await setup(t)
  const prepared=await call('gwz_latex_prepare',{project_dir:'outputs/real-paper'})
  assert.equal(prepared.isError,false)
  const compiled=await call('gwz_latex_compile',{tex_file:prepared.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,false,JSON.stringify(compiled))
  assert.ok((await readFile(compiled.value.pdf)).subarray(0,5).equals(Buffer.from('%PDF-')))
  assert.equal(compiled.value.human_approval_recorded,false)
  assert.ok(ctx.shell.commands.some(c=>c.includes('--untrusted')))
  if(haveBuilder){
    assert.equal(compiled.value.pdf_audit.status,'checked')
    assert.equal(compiled.value.pdf_audit.all_fonts_embedded,true)
    assert.ok(compiled.value.pdf_audit.fonts.some(font=>font.name.includes('OpenGlyph')))
  }
  const again=await call('gwz_latex_compile',{tex_file:prepared.value.tex_file,allow_downloads:false})
  assert.equal(again.isError,false)
  assert.notEqual(again.value.pdf,compiled.value.pdf)
  assert.ok(await readFile(compiled.value.pdf))
})

test('OCR JSON imports the primary reading and compiles with checked ordinary font coverage',
  {skip:!haveTectonic||!haveBuilder},async t=>{
  const {root,call}=await setup(t)
  const text='清華簡記載了西周的史事。'
  await writeFile(join(root,'ocr.json'),JSON.stringify({ok:true,result:{text,complete:true,
    machine_reading:true,reading_verified:false,lines:[{options:[{text:'不应进入正文'}]}]}}))
  const imported=await call('gwz_latex_ocr',{source_file:'ocr.json',project_dir:'outputs/ocr-paper'})
  assert.equal(imported.isError,false,JSON.stringify(imported))
  assert.equal(imported.value.font_coverage_checked,true)
  assert.equal(await readFile(join(imported.value.project_dir,'text.txt'),'utf8'),text)
  assert.doesNotMatch(await readFile(join(imported.value.project_dir,'body.tex'),'utf8'),/不应进入正文/)
  const compiled=await call('gwz_latex_compile',{tex_file:imported.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,false,JSON.stringify(compiled))
  assert.equal(compiled.value.pdf_audit.all_fonts_embedded,true)
  assert.equal(compiled.value.warnings.length,0)
})

test('OCR typesetting reuses a matching composition receipt with real outline fonts',
  {skip:!haveTectonic||!haveBuilder},async t=>{
  const {root,ctx,call}=await setup(t)
  // Real sample outlines exercise the handoff; they are not identity claims.
  await writeFile(join(root,'newforms.json'),JSON.stringify({schema:'openglyph.project.v1',namespace:'ocrtest',
    glyphs:[{id:'g1',base:'ebag:s030-067',edits:[]},{id:'g2',base:'ebag:s131-009',edits:[]}]}))
  const forms=await call('gwz_latex_build',{project_file:'newforms.json',output_dir:'outputs/forms'})
  assert.equal(forms.isError,false,JSON.stringify(forms))
  const bundle=join(root,'font.zip')
  await run(python,['-c',String.raw`import sys,zipfile,pathlib
with zipfile.ZipFile(sys.argv[2],'w') as archive:
    for path in pathlib.Path(sys.argv[1]).iterdir():
        if path.is_file():archive.write(path,path.name)
`,forms.value.output_dir,bundle])
  const text='<gw:ebag_s093-073><ids>⿱艹⿰日月</ids>'
  await writeFile(join(root,'ocr.json'),JSON.stringify({text,complete:true}))
  const items=[{glyph:'ebag_s093-073'},{ids:'⿱艹⿰日月'}]
  const record={schema:'openglyph.dsh.receipt.v1',tool:'glyph_compose',envelope:{ok:true,status:'complete',
    request:{name:'glyph_compose',arguments:{items}},result:{all_ok:true,items:[
      {index:1,ok:true,result:{gwz_code:'gwz:two'}},{index:0,ok:true,result:{gwz_code:'gwz:one'}}],
    print_font:{status:'ready',all_items_included:true,bundle_asset:{asset_id:'asset:'+'b'.repeat(64)},
      latex_aliases:[{code:'gwz:one',alias:'ocrtest:g1'},{code:'gwz:two',alias:'ocrtest:g2'}]}}}}
  await writeFile(join(root,'composition.json'),JSON.stringify(record))
  const prior=ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
  ctx.subprocess.resolveExecutable=async command=>command==='guwenzi-tools'?process.execPath:prior(command)
  ctx.subprocess.spawn=spec=>{
    assert.ok(spec.argv.includes('asset'),'the resume path must only download, never submit')
    const target=spec.argv[spec.argv.indexOf('--output')+1]
    const child=spawn(process.execPath,['-e',String.raw`const fs=require('fs');fs.copyFileSync(process.argv[1],process.argv[2]);console.log(JSON.stringify({ok:true,result:{path:process.argv[2]}}))`,bundle,target])
    return {stdout:child.stdout,stderr:child.stderr,done:new Promise((resolve,reject)=>{
      child.on('error',reject);child.on('close',exitCode=>resolve({exitCode}))}),terminate:()=>child.kill()}
  }
  const result=await call('gwz_latex_ocr',{source_file:'ocr.json',project_dir:'outputs/resumed',composition_file:'composition.json'})
  assert.equal(result.isError,false,JSON.stringify(result))
  assert.deepEqual(result.value.aliases,{'gw:ebag_s093-073':'ocrtest:g1','ids:⿱艹⿰日月':'ocrtest:g2'})
  assert.equal(await readFile(join(result.value.project_dir,'text.txt'),'utf8'),text)
  const compiled=await call('gwz_latex_compile',{tex_file:result.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,false,JSON.stringify(compiled))
  assert.equal(compiled.value.warnings.length,0)
  record.envelope.request.arguments.items=[{glyph:'u4e00'}]
  await writeFile(join(root,'wrong.json'),JSON.stringify(record))
  const rejected=await call('gwz_latex_ocr',{source_file:'ocr.json',project_dir:'outputs/mismatch',composition_file:'wrong.json'})
  assert.equal(rejected.isError,true)
})

test('real inspect → edited JSON font → ordinary/ebag/custom mixed PDF',{skip:!haveTectonic||!haveBuilder},async t=>{
  const {root,call}=await setup(t)
  const prepared=await call('gwz_latex_prepare',{project_dir:'outputs/new-form-paper'})
  assert.equal(prepared.isError,false)
  const inspected=await call('gwz_latex_inspect',{base:'ebag:s030-067',node:'root'})
  assert.equal(inspected.isError,false,JSON.stringify(inspected))
  assert.ok(inspected.content.some(b=>b.type==='image'))
  const project=join(prepared.value.project_dir,'newforms.json')
  await writeFile(project,JSON.stringify({schema:'openglyph.project.v1',namespace:'demo',glyphs:[{id:'extra',base:'ebag:s030-067',edits:[
    {op:'insert',parent:'root',id:'dot',glyph:'primitive:dot',box:[77,129,119,167]}]}]}))
  const built=await call('gwz_latex_build',{project_file:project,output_dir:join(prepared.value.project_dir,'myglyphs')})
  assert.equal(built.isError,false,JSON.stringify(built))
  assert.equal(built.value.aliases[0].latex,'\\gwglyph{demo:extra}')
  const original=await readFile(prepared.value.tex_file,'utf8')
  const tex=original.replace('\\begin{document}','\\OpenGlyphLoad{myglyphs}\n\\begin{document}')
    .replace('\\end{document}','新字候选：\\gwglyph{demo:extra}；既有字：\\ebag{s030-067}。\\end{document}')
  await writeFile(prepared.value.tex_file,tex)
  const compiled=await call('gwz_latex_compile',{tex_file:prepared.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,false,JSON.stringify(compiled))
  assert.equal(compiled.value.pdf_audit.all_fonts_embedded,true)
  assert.ok(compiled.value.pdf_audit.fonts.some(f=>f.name.includes('OpenGlyph-')))
  const bundle=join(root,'font-bundle.zip')
  await run(python,['-c',String.raw`import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED) as archive:
    for path in root.rglob('*'):
        if path.is_file():archive.write(path,path.relative_to(root).as_posix())
`,built.value.output_dir,bundle])
  const imported=await call('gwz_latex_prepare',{project_dir:'outputs/imported-font-paper',font_bundle:bundle})
  assert.equal(imported.isError,false,JSON.stringify(imported))
  assert.ok(imported.value.generated_aliases.includes('demo:extra'))
  const importedPDF=await call('gwz_latex_compile',{tex_file:imported.value.tex_file,allow_downloads:false})
  assert.equal(importedPDF.isError,false,JSON.stringify(importedPDF))
  assert.equal(importedPDF.value.pdf_audit.all_fonts_embedded,true)
  if(process.env.GWZ_DEMO_OUTPUT)await cp(prepared.value.project_dir,process.env.GWZ_DEMO_OUTPUT,{recursive:true,errorOnExist:true,force:false})
  console.log(JSON.stringify({actual_mixed_pdf:compiled.value.pdf,embedded:true,paid_calls:0}))
})

test('unknown glyph fails compilation instead of returning a stale PDF',{skip:!haveTectonic},async t=>{
  const {call}=await setup(t)
  const prepared=await call('gwz_latex_prepare',{project_dir:'outputs/unknown-form'})
  assert.equal(prepared.isError,false)
  const text=await readFile(prepared.value.tex_file,'utf8')
  await writeFile(prepared.value.tex_file,text.replace('\\end{document}','\\gwglyph{no:such-id}\\end{document}'))
  const compiled=await call('gwz_latex_compile',{tex_file:prepared.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,true)
  assert.match(compiled.content.find(b=>b.type==='text').text,/编译失败/)
})

test('quoted argv roundtrips all ASCII punctuation, Unicode and combinations without shell evaluation',async()=>{
  const cases=['','古文字 空格\nnext',...Array.from({length:127},(_,i)=>i+1).filter(n=>n!==0).map(n=>String.fromCharCode(n))]
  for(const a of ["'",'"','$','`','\\',';','\n','中'])for(const b of [' ',"'",'$','`','\\',';','\n','文'])cases.push(a+b)
  const command=[process.execPath,'-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--',...cases].map(shellQuote).join(' ')
  assert.deepEqual(JSON.parse(await run('/bin/sh',['-c',command])),cases)
})

test('font bundle rejects traversal, absolute paths, duplicate files and symlinks before writing',async t=>{
  const {root,call}=await setup(t)
  const bundle=join(root,'unsafe-font.zip')
  const examples=['../outside','/outside','nested/../../outside','a\\b','C:outside','catalog.tex','symlink']
  for(const [index,entry] of examples.entries()){
    await run(python,['-c',String.raw`import sys,zipfile,stat
with zipfile.ZipFile(sys.argv[1],'w') as archive:
    archive.writestr('catalog.tex','test')
    item=zipfile.ZipInfo(sys.argv[2])
    if sys.argv[2]=='symlink':item.external_attr=(stat.S_IFLNK|0o777)<<16
    archive.writestr(item,'test')
`,bundle,entry])
    const imported=await call('gwz_latex_prepare',{project_dir:'outputs/unsafe-'+index,font_bundle:bundle})
    assert.equal(imported.isError,true,JSON.stringify({entry,imported}))
    assert.equal(await access(join(root,'outputs','unsafe-'+index,'generated')).then(()=>true,()=>false),false)
  }
  assert.equal(await access(join(root,'outside')).then(()=>true,()=>false),false)
})

test('optional first-run workspace venv installs build dependencies and audits with pypdf only',{
  skip:!process.env.GWZ_TEST_INSTALL_DEPENDENCIES||!haveTectonic,
},async t=>{
  const {root,call}=await setup(t)
  const installed=await call('gwz_latex_setup',{install_dependencies:true})
  assert.equal(installed.isError,false,JSON.stringify(installed))
  assert.equal(installed.value.global_environment_changed,false)
  assert.equal(installed.value.python_info.modules.pypdf,true)
  assert.equal(installed.value.python_info.modules.pymupdf,false)
  assert.equal(installed.value.python_info.modules.fitz,false)
  assert.equal(installed.value.capabilities.offline_font_build,true)
  assert.ok(installed.value.python.startsWith(root)||installed.value.python.includes('openglyph-latex-test-'))
  const prepared=await call('gwz_latex_prepare',{project_dir:'outputs/pypdf-paper'})
  const compiled=await call('gwz_latex_compile',{tex_file:prepared.value.tex_file,allow_downloads:false})
  assert.equal(compiled.isError,false,JSON.stringify(compiled))
  assert.equal(compiled.value.pdf_audit.status,'checked')
  assert.equal(compiled.value.pdf_audit.all_fonts_embedded,true)
  assert.ok(compiled.value.pdf_audit.fonts.some(font=>font.name.includes('OpenGlyph')))
  const repeated=await call('gwz_latex_setup',{install_dependencies:true})
  assert.equal(repeated.isError,false,JSON.stringify(repeated))
  assert.equal(repeated.value.python,installed.value.python)
})
