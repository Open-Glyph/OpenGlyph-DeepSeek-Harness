/** Evidence-preserving CLI jobs; all remote submissions have durable accepted IDs. */
import { readFile, writeFile, access } from 'node:fs/promises'
import { randomUUID,createHash } from 'node:crypto'
import { join,basename } from 'node:path'
import { Cli,CliFailure,receipt } from './cli.js'
import { inputFile,outputDirectory,workspacePath } from './paths.js'
import { summary,previewRefs } from './results.js'
import { validator,validateCall } from './schema.js'
const present=path=>access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})

const RECEIPT='openglyph.dsh.receipt.v1'
const fontFiles={otf_asset:'排印字体.otf',ttf_asset:'排印字体.ttf',mapping_asset:'字形码位映射.json',
  text_asset:'可复制文字.txt',word_sample_asset:'嵌入字体示例.docx',bundle_asset:'OpenGlyph-LaTeX排印包.zip',project_asset:'可编辑造字项目.json'}

export class Controller {
  constructor(ctx,config,catalog,guides) {
    this.ctx=ctx;this.config=config;this.catalog=catalog;this.guides=guides
    this.cli=new Cli(ctx.subprocess,config)
    this.validators=new Map(catalog.tools.map(t=>[t.name,validator(t.input_schema)]))
  }

  async stage(exec,label) {
    const cwd=this.config.workspaceRoot || (exec.agent?this.ctx.workingDirectory.get(exec.agent.session):process.cwd())
    const directory=await outputDirectory(cwd,join(this.config.evidenceDirectory,label+'-'+randomUUID()))
    return {cwd,directory,signal:exec.signal,agent:exec.agent}
  }

  async run(context,args,input) {return this.cli.run(args,{...context,input})}

  async live(context) {
    const value=await this.run(context,['tools','--server'])
    const catalog=value.result||value
    if(catalog.protocol!=='guwenzi.tools.v1' || !Array.isArray(catalog.tools)) throw new Error('工具服务协议不匹配；没有提交任务。')
    return catalog
  }

  /** Validate against both packaged and live schemas BEFORE the one POST. */
  async remote(tool,args,exec,context) {
    context ||= await this.stage(exec,tool)
    if(tool==='page_prepare' && args.detail===undefined) args={...args,detail:'image'}
    this.validators.get(tool)(args)
    validateCall(tool,args)
    const live=await this.live(context)
    const current=live.tools.find(t=>t.name===tool)
    if(!current) throw new Error('当前服务未部署 '+tool+'；没有提交该任务。')
    validator(current.input_schema)(args)
    const acceptance=await this.run(context,['call',tool,'--json','-','--detach'],args)
    const accepted=acceptance.result||acceptance
    const id=accepted.job_id
    if(!/^j[a-f0-9]{32}$/.test(id||'')) throw new Error('任务接受结果不明确，不可重发；请查看本地 CLI 凭据。')
    await receipt(join(context.directory,'accepted.json'),{schema:RECEIPT,tool,arguments:args,job_id:id})
    let envelope
    try {envelope=await this.run(context,['status',id,'--wait'])}
    catch(error) {
      throw new CliFailure(error.message||'停止了等待；远端任务没有被取消。',{
        ...error.details,job_id:id,next_tool:'gwz_resume',accepted_receipt:join(context.directory,'accepted.json')})
    }
    return this.observe(tool,envelope,context,0)
  }

  async observe(tool,envelope,context,offset) {
    const path=join(context.directory,'result.json')
    await receipt(path,{schema:RECEIPT,tool,envelope})
    return this.observation(tool,envelope,path,context,offset)
  }

  async observation(tool,envelope,path,context,offset=0,imageOffset=0) {
    const result=envelope.result||{}
    const refs=previewRefs(result)
    const selected=refs.slice(imageOffset,imageOffset+this.config.imagePageSize)
    const images=[],imageFailures=[]
    for(const {asset,label} of selected) {
      try {
        const destination=join(context.directory,asset.asset_id.slice(6)+'.preview.png')
        const downloaded=await this.run(context,['asset',asset.asset_id,'--view','--output',destination])
        const image=downloaded.result||downloaded
        const data=await readFile(image.path)
        const actual=createHash('sha256').update(data).digest('hex')
        if(actual!==image.sha256) throw new Error('预览图校验失败')
        const attachment=await this.ctx.attachments.saveImage({data,mediaType:'image/png',name:label+'.png'})
        images.push({label,asset_id:asset.asset_id,attachment})
      } catch(error) {
        if(context.signal.aborted) throw error
        imageFailures.push({asset_id:asset.asset_id,message:error.message})
      }
    }
    const guide=this.guides[tool]
    return {status:envelope.status||'complete',tool,job_id:envelope.job_id||null,
      full_json:path,summary:summary(result,offset,this.config.resultPageSize),result,
      images,image_failures:imageFailures,
      image_pagination:{total:refs.length,offset:imageOffset,next_offset:imageOffset+selected.length<refs.length?imageOffset+selected.length:null},
      next_tools:guide?.next||[],
      cautions:tool==='glyph_compose'?['字体可下载不等于字形正确。用最终字体做 glyph_verify，把差异交人核定。']:[],
      paging:'完整记录未截断。用 gwz_evidence 读取后续候选或图片；预览坐标不是原图坐标。'}
  }

  async upload(args,exec,context) {
    context ||= await this.stage(exec,'上传文件')
    const file=await inputFile(context.cwd,args.file,this.config.additionalInputRoots)
    const uploaded=await this.run(context,['upload',file])
    const value=uploaded.result||uploaded
    const path=await receipt(join(context.directory,'upload.json'),{input_key:value.input_key,sha256:value.sha256,source_name:basename(file)})
    return {status:'uploaded',...value,upload_receipt:path,images:[],next_tools:['gwz_document_open','gwz_asset_import']}
  }

  async open(args,exec) {
    const context=await this.stage(exec,'文献登记')
    const value=await this.upload(args,exec,context)
    return this.remote(args.kind==='image'?'asset_import':'document_open',{input_key:value.input_key},exec,context)
  }

  async ocr(args,exec) {
    const context=await this.stage(exec,'OCR识别')
    const output=args.output_dir?await workspacePath(context.cwd,args.output_dir,{existing:Boolean(args.resume)}):join(context.directory,'result')
    const command=['ocr']
    if(args.resume)command.push('--resume')
    else{
      validateCall('text_read',args)
      const image=await inputFile(context.cwd,args.image,this.config.additionalInputRoots)
      if(await present(output))throw new Error('OCR回执目录已存在；使用gwz_ocr_resume或选择新目录。')
      command.push(image)
      if(args.layout)command.push('--layout',args.layout)
      if(args.writing_mode)command.push('--writing-mode',args.writing_mode)
      if(args.second_options)command.push('--second-options')
    }
    try{await this.run(context,[...command,'--output',output])}
    catch(error){throw new CliFailure(error.message,{...error.details,output_dir:output,resume_tool:'gwz_ocr_resume'})}
    const full=join(output,'result.json'),envelope=JSON.parse(await readFile(full,'utf8')),result=envelope.result
    if(envelope.ok!==true||typeof result?.text!=='string')throw new Error('OCR没有返回完整结果：'+full)
    return {status:'machine_reading',job_id:envelope.job_id,full_json:full,
      text_file:join(output,'text.txt'),output_dir:output,text:result.text,complete:result.complete,
      lines:result.lines,skipped_regions:result.skipped_regions,model:result.model,
      reading_verified:false,images:[],next_tools:['gwz_latex_ocr']}
  }

  async resume(args,exec) {
    const context=await this.stage(exec,'恢复任务')
    const response=await this.run(context,['status',args.job_id,...(args.wait?['--wait']:[])])
    const envelope=response.job_id?response:response.result
    if(['queued','running'].includes(envelope.status)) return {status:envelope.status,job_id:args.job_id,next_tools:['gwz_resume'],images:[]}
    return this.observe(envelope.request?.name||'unknown',envelope,context,0)
  }

  async stored(file,exec) {
    const context=await this.stage(exec,'证据查阅')
    const path=await inputFile(context.cwd,file)
    const record=JSON.parse(await readFile(path,'utf8'))
    if(record.schema!==RECEIPT || !record.envelope || !record.tool) throw new Error('请选择插件实际返回的 full_json 记录，不接受任意文件。')
    return {context,path,record}
  }

  async evidence(args,exec) {
    const {context,path,record}=await this.stored(args.full_json,exec)
    return this.observation(record.tool,record.envelope,path,context,args.offset||0,args.image_offset||0)
  }

  async deliver(args,exec) {
    const {context,record}=await this.stored(args.full_json,exec)
    const pack=record.envelope.result?.print_font
    if(!pack || pack.status!=='ready') throw new Error('这不是已经生成字体的造字结果。先调用 gwz_glyph_compose；单独登记原图不会生成字体。')
    const destination=await outputDirectory(context.cwd,join(this.config.deliverableDirectory,args.name))
    const files=[]
    for(const [field,name] of Object.entries(fontFiles)) {
      const asset=pack[field]
      if(!asset?.asset_id) continue
      const path=join(destination,name)
      try {await access(path);throw new Error('成果目录已有同名文件，请换一个 name，避免覆盖：'+name)}
      catch(error) {if(error.code!=='ENOENT') throw error}
      const response=await this.run(context,['asset',asset.asset_id,'--output',path])
      const downloaded=response.result||response
      files.push({name,path,asset_id:asset.asset_id,sha256:downloaded.sha256})
    }
    const review=pack.visual_acceptance?.status||'not_checked'
    const note='本目录是可排印候选稿。OTF/TTF 与码位映射必须一同保存；PUA 不是正式 Unicode 身份。\n'
      +'原图—最终字体比较状态：'+review+'。即使程序比较通过，也需人工核定字形和学术释读。\n'
      +'原始记录：'+args.full_json+'\n'
    await writeFile(join(destination,'排印与核对说明.txt'),note,{flag:'wx',mode:0o600})
    return {status:'printable_draft',directory:destination,files,review_status:review,human_approval_recorded:false,images:[],next_tools:['gwz_glyph_verify']}
  }
}
