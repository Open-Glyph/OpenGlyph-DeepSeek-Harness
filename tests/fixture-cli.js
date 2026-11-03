/** Keyless local CLI double. Bytes are fixtures, not real font-generation claims. */
import { readFile,mkdir,writeFile,appendFile,access } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes,createHash } from 'node:crypto'

const source=JSON.parse(await readFile(new URL('../data/service-tools.json',import.meta.url),'utf8'))
let argv=process.argv.slice(2).filter(x=>x!=='--quiet')
if(argv[0]==='--profile')argv=argv.slice(2)
const [command,...args]=argv
const answer=value=>console.log(JSON.stringify(value))
const sha=raw=>createHash('sha256').update(raw).digest('hex')
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJAAAAAASUVORK5CYII=','base64')
const payloads={png:image,font:Buffer.from('OTTO-test-only-font'),mapping:Buffer.from('{"family":"test","glyphs":[]}'),text:Buffer.from('\ue000'),word:Buffer.from('test-only-docx'),zip:Buffer.from('test-only-latex')}
const assets=Object.fromEntries(Object.entries(payloads).map(([name,bytes])=>[name,{asset_id:'asset:'+sha(bytes),sha256:sha(bytes),path:'fixture.'+({png:'png',font:'otf',mapping:'json',text:'txt',word:'docx',zip:'zip'}[name])}]))
const program={schema:'guwenzi.template-program.v1',base:'ebag:s030-067',edits:[]}
const resultFor=tool=>{
  if(tool==='document_open')return {document_id:'d'+'a'.repeat(32),pages:100,source_sha256:'f'.repeat(64)}
  if(tool==='asset_import')return assets.png
  if(tool==='page_prepare')return {page:32,page_asset:assets.png,source_size_px:[1,1]}
  if(tool==='glyph_template_search')return {candidates:[{candidate_id:'c1',program,asset:assets.png,editable:true}],next_offset:null}
  if(tool==='glyph_template_inspect')return {program,nodes:[{node:'r4',asset:assets.png}],whole_asset:assets.png}
  if(tool==='glyph_compose')return {gwz_code:'gwz:test',asset:assets.png,print_font:{status:'ready',glyphs:[{codepoint:0xe000}],
    otf_asset:assets.font,ttf_asset:assets.font,mapping_asset:assets.mapping,text_asset:assets.text,word_sample_asset:assets.word,bundle_asset:assets.zip,
    visual_acceptance:{status:'not_checked'},deliverable_as_verified:false}}
  if(tool==='glyph_detect')return {candidate_count:1,source_size_px:[1,1],candidates:[{candidate_id:'c1',bbox_px:[0,0,1,1],asset:assets.png}],contact_sheets:[{contact_sheet_asset:assets.png}]}
  return {ok:true,content_verified:false}
}
if(command==='tools')answer({ok:true,result:source})
else if(command==='doctor')answer({ok:true,result:{health:{status:'ok',protocol:source.protocol},ready:{status:'resources_present'}}})
else if(command==='upload'){
  const data=await readFile(args[0]);answer({ok:true,result:{input_key:'fixture/input.pdf',sha256:sha(data),bytes:data.length}})
}else if(command==='call'){
  let stdin='';for await(const chunk of process.stdin)stdin+=chunk
  const arguments_=JSON.parse(stdin)
  const id='j'+randomBytes(16).toString('hex')
  await mkdir(join(process.cwd(),'.fixture-jobs'),{recursive:true})
  const envelope={ok:true,job_id:id,status:'complete',request:{name:args[0],arguments:arguments_},result:resultFor(args[0])}
  await writeFile(join(process.cwd(),'.fixture-jobs',id+'.json'),JSON.stringify(envelope))
  await appendFile(join(process.cwd(),'.fixture-posts.jsonl'),JSON.stringify({job_id:id,tool:args[0],arguments:arguments_})+'\n')
  answer({ok:true,result:{job_id:id,status:'queued',receipt:'local-cli-receipt'}})
}else if(command==='status'){
  const pause=await access(join(process.cwd(),'.fixture-pause')).then(()=>true,()=>false)
  if(pause)await new Promise(resolve=>setTimeout(resolve,60_000))
  if(args[0]==='j'+'0'.repeat(32))answer({ok:true,result:{job_id:args[0],status:'running'}})
  else answer(JSON.parse(await readFile(join(process.cwd(),'.fixture-jobs',args[0]+'.json'),'utf8')))
}else if(command==='asset'){
  const ref=args[0],index=args.indexOf('--output');const path=args[index+1]
  const key=Object.keys(payloads).find(k=>assets[k].asset_id===ref)
  if(!key)throw new Error('unknown fixture asset')
  const data=args.includes('--view')?image:payloads[key]
  await writeFile(path,data)
  answer({ok:true,result:{path,sha256:sha(data),bytes:data.length,view:args.includes('--view')}})
}else throw new Error('unhandled fixture CLI command '+command)
