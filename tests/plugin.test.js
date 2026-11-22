import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,mkdir,symlink,rm,readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Context,Service } from '@deepseek-ai/cordis'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools,{assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.js'
import { modelSchema,validator,validateCall } from '../src/schema.js'
import { workspacePath } from '../src/paths.js'
import { setTimeout as delay } from 'node:timers/promises'

const fixture=fileURLToPath(new URL('./fixture-cli.js',import.meta.url))

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'openglyph-dsh-'))
  const ctx=new Context()
  await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(Skills)
  class Process extends Service {
    constructor(context){super(context,'subprocess')}
    async resolveExecutable(){return fixture}
    spawn(spec){
      const child=spawn(process.execPath,[fixture,...spec.argv.slice(1)],{cwd:spec.cwd,signal:spec.signal,stdio:['pipe','pipe','pipe']})
      child.on('error',()=>{})
      child.stdin.end(spec.stdio.stdin?.data||'')
      return {stdout:child.stdout,stderr:child.stderr,done:new Promise((resolve,reject)=>{
        child.on('error',reject);child.on('close',(exitCode,signal)=>resolve({exitCode,signal}))
      }),terminate:()=>child.kill('SIGTERM')}
    }
  }
  class Attachments extends Service {
    constructor(context){super(context,'attachments')}
    async saveImage({data,mediaType,name}){
      return {id:'sha256:'+createHash('sha256').update(data).digest('hex'),mediaType,name,bytes:data.length,width:1,height:1}
    }
  }
  class WorkingDirectory extends Service {
    constructor(context){super(context,'workingDirectory')}
    get(){return root}
    async ensure(){return root}
  }
  class Shell extends Service {constructor(context){super(context,'shell')}}
  await ctx.plugin(Process);await ctx.plugin(Shell);await ctx.plugin(Attachments);await ctx.plugin(WorkingDirectory)
  const fiber=await ctx.plugin(plugin,{workspaceRoot:root})
  let count=0
  const call=(name,args,signal=new AbortController().signal)=>ctx.tools.execute({
    callId:ToolCallId('fixture-'+(++count)),name,arguments:args,signal})
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
  return {root,ctx,fiber,call}
}

test('registers 37 tools and unload removes every contribution',async t=>{
  const {ctx,fiber}=await setup(t)
  assert.equal(ctx.tools.schemas().filter(s=>s.name.startsWith('gwz_')).length,37)
  const skill=await ctx.skills.get('openglyph')
  assert.ok(skill.invocation.userInvocable)
  assert.match(skill.content,/gwz_latex_compile/)
  assert.match(skill.content,/OpenGlyphLoad/)
  assert.ok(await ctx.skills.get('openglyph-paleography'))
  const compose=ctx.tools.get('gwz_glyph_compose')
  assert.match(compose.description,/OTF\/TTF/)
  assert.ok(compose.parameters.properties.program)
  assert.ok(compose.parameters.properties.ids)
  assert.equal(ctx.tools.get('gwz_page_prepare').parameters.properties.detail.default,'image')
  assert.ok(ctx.tools.get('gwz_text_read'))
  assert.ok(ctx.tools.get('gwz_ocr'))
  assert.ok(ctx.tools.get('gwz_ocr_resume'))
  assert.ok(ctx.tools.get('gwz_latex_ocr'))
  await fiber.dispose()
  assert.equal(ctx.tools.schemas().filter(s=>s.name.startsWith('gwz_')).length,0)
})

test('image OCR returns exact OCR-IDS markup and a reusable full JSON receipt',async t=>{
  const {call,root}=await setup(t)
  await writeFile(join(root,'line.png'),Buffer.from('test image'))
  const response=await call('gwz_ocr',{image:'line.png',writing_mode:'vertical-rl',second_options:true})
  assert.equal(response.isError,false,JSON.stringify(response))
  assert.equal(response.value.text,'𤪷<gw:ebag_s093-073><ids>⿱艹⿰日月</ids>')
  assert.equal(response.value.reading_verified,false)
  const envelope=JSON.parse(await readFile(response.value.full_json,'utf8'))
  assert.equal(envelope.result.text,response.value.text)
  const rejected=await call('gwz_text_read',{asset_id:'asset:'+'a'.repeat(64),layout:'page',second_options:true})
  assert.equal(rejected.isError,true)
})

test('registered-image OCR exposes its exact main text to the model even without line results',async t=>{
  const {call}=await setup(t)
  const response=await call('gwz_text_read',{asset_id:'asset:'+'a'.repeat(64),layout:'page'})
  assert.equal(response.isError,false,JSON.stringify(response))
  const visible=JSON.parse(response.content.find(row=>row.type==='text').text)
  assert.equal(visible.summary.text,'𤪷<gw:ebag_s093-073><ids>⿱艹⿰日月</ids>')
  assert.equal(visible.summary.complete,true)
  assert.equal(visible.summary.reading_verified,false)
  assert.equal(JSON.parse(await readFile(visible.full_json,'utf8')).envelope.result.text,visible.summary.text)
})

test('image → editable template → inspected nodes → compose → ordered font delivery through real DSH dispatch',async t=>{
  const {call,root}=await setup(t)
  const opened=await call('gwz_open',{file:'input.pdf'})
  // The first attempt correctly fails on the absent user file, not a network POST.
  assert.equal(opened.isError,true)
  await writeFile(join(root,'input.pdf'),'%PDF-fixture')
  const document=await call('gwz_open',{file:'input.pdf'})
  assert.equal(document.isError,false)
  const page=await call('gwz_page_prepare',{document_id:document.value.result.document_id,page:32})
  assert.equal(page.isError,false)
  assert.ok(page.content.some(b=>b.type==='image'))
  assert.equal(page.value.result.image_to_pdf_transform[2],0)
  assert.equal(Object.is(page.value.result.image_to_pdf_transform[2],-0),false)
  assert.equal(page.value.summary.source_image_original,true)
  assert.equal(page.value.summary.pixel_resampling,false)
  assert.equal(page.value.summary.image_to_pdf_transform[2],0)
  const pageFiles=await readdir(join(root,'work/openglyph'))
  const pageDir=pageFiles.find(name=>name.startsWith('page_prepare-'))
  const outputs=await readdir(join(root,'work/openglyph',pageDir))
  const raw=await Promise.all(outputs.filter(f=>f.endsWith('.stdout.json')).map(f=>readFile(join(root,'work/openglyph',pageDir,f),'utf8')))
  assert.ok(raw.some(text=>text.includes('-0.0')),'must exercise and retain Python-style negative-zero wire bytes')
  const image=page.value.result.page_asset.asset_id
  const search=await call('gwz_glyph_template_search',{asset_id:image})
  assert.equal(search.isError,false)
  const program=search.value.result.candidates[0].program
  const inspected=await call('gwz_glyph_template_inspect',{program})
  assert.equal(inspected.isError,false)
  assert.equal(inspected.value.result.nodes[0].node,'r4')
  const composed=await call('gwz_glyph_compose',{program})
  assert.equal(composed.isError,false)
  assert.equal(composed.value.result.print_font.status,'ready')
  assert.match(composed.content.find(b=>b.type==='text').text,/最终字体/)
  const deliver=await call('gwz_deliver',{full_json:composed.value.full_json,name:'第32页-候选稿'})
  assert.equal(deliver.isError,false)
  assert.equal(deliver.value.status,'printable_draft')
  assert.ok(deliver.value.files.some(f=>f.name==='排印字体.otf'))
  assert.ok(deliver.value.files.some(f=>f.name.endsWith('.zip')))
  assert.equal(deliver.value.human_approval_recorded,false)
  const posts=(await readFile(join(root,'.fixture-posts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(posts.filter(p=>p.tool==='glyph_compose').length,1)
  assert.equal(posts.find(p=>p.tool==='page_prepare').arguments.detail,'image')
  assert.ok(!posts.some(p=>p.tool==='layout_analyze'))
})

test('full schema rejects ambiguous compose, wrong numeric range and unexpected fields before any POST',async t=>{
  const {call,root}=await setup(t)
  for(const args of [{glyph:'u4e00',ids:'⿰木木'},{program:{},kage_json:'raw'},{items:[]}]) {
    assert.equal((await call('gwz_glyph_compose',args)).isError,true)
  }
  assert.equal((await call('gwz_glyph_detect',{asset_id:'asset:'+'a'.repeat(64),confidence:1.1})).isError,true)
  await assert.rejects(readFile(join(root,'.fixture-posts.jsonl')),/ENOENT/)
})

test('queued/running status is unwrapped and never resubmitted',async t=>{
  const {call,root}=await setup(t)
  const response=await call('gwz_resume',{job_id:'j'+'0'.repeat(32),wait:false})
  assert.equal(response.isError,false)
  assert.equal(response.value.status,'running')
  await assert.rejects(readFile(join(root,'.fixture-posts.jsonl')),/ENOENT/)
})

test('cancelling a wait retains accepted job and can resume without a second POST',async t=>{
  const {call,root}=await setup(t)
  await writeFile(join(root,'.fixture-pause'),'pause only this test CLI')
  const abort=new AbortController()
  const pending=call('gwz_glyph_compose',{program:{schema:'guwenzi.template-program.v1',base:'ebag:s030-067',edits:[]}},abort.signal)
  let posts=[]
  for(let i=0;i<100;i++){
    try{posts=(await readFile(join(root,'.fixture-posts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)}catch(error){if(error.code!=='ENOENT')throw error}
    if(posts.length)break
    await delay(20)
  }
  assert.equal(posts.length,1)
  // Let the acceptance receipt settle before cancelling the status wait.
  await delay(100);abort.abort(new Error('caller stopped waiting'))
  const cancelled=await pending
  assert.equal(cancelled.isError,true)
  await rm(join(root,'.fixture-pause'))
  const resumed=await call('gwz_resume',{job_id:posts[0].job_id})
  assert.equal(resumed.isError,false)
  const after=(await readFile(join(root,'.fixture-posts.jsonl'),'utf8')).trim().split('\n')
  assert.equal(after.length,1)
})

test('complete receipts preserve all candidates across explicit pagination, without another model job',async t=>{
  const {call,root}=await setup(t)
  const path=join(root,'result.json')
  const rows=Array.from({length:80},(_,i)=>({candidate_id:'c'+i,score:i/100}))
  await writeFile(path,JSON.stringify({schema:'openglyph.dsh.receipt.v1',tool:'glyph_search',envelope:{job_id:'j'+'a'.repeat(32),result:{candidates:rows}}}))
  const first=await call('gwz_evidence',{full_json:path,offset:0})
  const next=await call('gwz_evidence',{full_json:path,offset:32})
  assert.equal(first.isError,false);assert.equal(next.isError,false)
  assert.equal(first.value.summary.pagination.candidates.total,80)
  assert.equal(first.value.summary.pagination.candidates.next_offset,32)
  assert.equal(next.value.summary.candidates[0].candidate_id,'c32')
  assert.equal(next.value.result.candidates.length,80)
  await assert.rejects(readFile(join(root,'.fixture-posts.jsonl')),/ENOENT/)
})

test('rejects parent traversal and symlink escapes without uploading',async t=>{
  const {root,call}=await setup(t)
  const outside=await mkdtemp(join(tmpdir(),'openglyph-outside-'))
  t.after(()=>rm(outside,{recursive:true,force:true}))
  await writeFile(join(outside,'secret.pdf'),'not authorized')
  await symlink(outside,join(root,'escape'))
  await assert.rejects(workspacePath(root,'escape/secret.pdf',{existing:true}),/超出/)
  assert.equal((await call('gwz_open',{file:join(outside,'secret.pdf')})).isError,true)
  await assert.rejects(readFile(join(root,'.fixture-posts.jsonl')),/ENOENT/)
})

test('catalog explicitly distinguishes persistence from OCR, registration from composition and fidelity from ranking',async t=>{
  const {call}=await setup(t)
  const response=await call('gwz_catalog',{tool_name:'glyph_register'})
  assert.equal(response.isError,false)
  assert.match(response.value.purpose,/不会生成/)
  const transcription=await call('gwz_catalog',{tool_name:'transcribe'})
  assert.match(transcription.value.purpose,/完全不会调用 OCR/)
})

test('all generated DSH schemas contain no unsupported references or numeric constraints; strict validator keeps them',()=>{
  for(const row of plugin.catalog.tools) {
    const projected=modelSchema(row.input_schema)
    assertSupportedJsonSchema(projected)
    assert.ok(projected.type==='object')
    assert.doesNotMatch(JSON.stringify(projected),/"\$ref"|"\$defs"|"minimum"\s*:/)
  }
  const validate=validator({type:'object',properties:{x:{type:'integer',minimum:1}},required:['x'],additionalProperties:false})
  assert.deepEqual(validate({x:2}),{x:2})
  assert.throws(()=>validate({x:0}))
})

test('all 64 compose selector combinations admit exactly one mode; empty/multiple modes reject',()=>{
  const values={glyph:'u4e00',ids:'⿰木木',structure:{op:'⿰',children:[{glyph:'u6728'},{glyph:'u6728'}]},
    program:{schema:'guwenzi.template-program.v1',base:'ebag:s030-067',edits:[]},
    proposal_id:'tp'+'a'.repeat(64),items:[{glyph:'u4e00'}]}
  const entries=Object.entries(values)
  for(let mask=0;mask<64;mask++) {
    const selected=entries.filter((_,index)=>mask&(1<<index))
    const args=Object.fromEntries(selected)
    if(args.proposal_id&&!args.items)args.hint_asset_id='asset:'+'a'.repeat(64)
    if(selected.length===1)assert.equal(validateCall('glyph_compose',args),args)
    else assert.throws(()=>validateCall('glyph_compose',args))
  }
})
