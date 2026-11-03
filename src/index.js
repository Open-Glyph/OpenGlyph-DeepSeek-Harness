/** OpenGlyph native tool bundle: typed input discovery, visual evidence and fonts. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { Controller } from './controller.js'
import { modelSchema,validator } from './schema.js'
import { render } from './results.js'

export const name='openglyph'
export const inject=['tools','systemPrompt','skills','subprocess','attachments','workingDirectory']
export const Config=Schema.object({
  cli:Schema.string().default('guwenzi-tools'),
  profile:Schema.string().default(''),
  workspaceRoot:Schema.string(),
  additionalInputRoots:Schema.array(Schema.string()).default([]),
  evidenceDirectory:Schema.string().default('work/openglyph'),
  deliverableDirectory:Schema.string().default('outputs/古文字排印'),
  imagePageSize:Schema.number().min(1).step(1).default(4),
  resultPageSize:Schema.number().min(1).step(1).default(32),
  cancelGraceMs:Schema.number().min(1).default(3000),
})

export const catalog=JSON.parse(readFileSync(new URL('../data/service-tools.json',import.meta.url),'utf8'))
export const guides=JSON.parse(readFileSync(new URL('../data/tool-guides.json',import.meta.url),'utf8'))
const persona=readFileSync(new URL('../data/workflow.md',import.meta.url),'utf8')
const skillPath=fileURLToPath(new URL('../skills/openglyph-paleography/SKILL.md',import.meta.url))

const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false})
const string=description=>({type:'string',minLength:1,description})
const helperSchemas={
  gwz_check:object({}),
  gwz_catalog:object({tool_name:string('可选服务端名称，例如 glyph_compose；省略时列出所有工具。')}),
  gwz_upload:object({file:string('用户指定的本地文件路径；仅上传，不登记文档或识字。')},['file']),
  gwz_open:object({file:string('用户指定的本地文件路径，默认仅限当前工作文件夹。'),
    kind:{type:'string',enum:['document','image'],default:'document',description:'PDF/论文用 document；单独字图用 image。'}},['file']),
  gwz_resume:object({job_id:{...string('已经接受的真实任务编号；本工具只查询/等待，不会重新提交。'),pattern:'^j[a-f0-9]{32}$'},
    wait:{type:'boolean',default:true}},['job_id']),
  gwz_evidence:object({full_json:string('之前工具返回的 full_json 原始记录路径。'),
    offset:{type:'integer',minimum:0,default:0,description:'候选/部件列表的偏移，不是 PDF 页码。'},
    image_offset:{type:'integer',minimum:0,default:0,description:'预览图列表的偏移；继续查看全部候选图页。'}},['full_json']),
  gwz_deliver:object({full_json:string('gwz_glyph_compose 返回的 full_json；必须含 print_font.status=ready。'),
    name:{...string('新成果文件夹名称，不含斜线；如 清华简第32页-排印候选稿。'),pattern:'^(?!\\.{1,2}$)[^/\\\\\\x00-\\x1f]+$'}},['full_json','name']),
}

/** Register all contributions as Cordis effects; unloading removes them together. */
export function apply(ctx,config) {
  const controller=new Controller(ctx,config,catalog,guides)
  const register=(tool,description,schema,execute,title)=>{
    const check=validator(schema)
    ctx.tools.register({name:tool,description,parameters:modelSchema(schema),
      output:{schema:{type:'object',additionalProperties:true},render},
      async execute(args,exec){
        check(args)
        try{return await execute(args,exec)}
        catch(error){
          const details=error.details||{}
          throw new Error(error.message+(Object.keys(details).length?'\n恢复信息：'+JSON.stringify(details):''))
        }
      },
      isConcurrencySafe:()=>tool!=='gwz_deliver',
      presentCall:()=>({card:'generic',title,kind:tool.includes('search')?'search':'execute'}),
    })
  }
  for(const row of catalog.tools) {
    const guide=guides[row.name]
    if(!guide)throw new Error('缺少工具说明：'+row.name)
    const schema=structuredClone(row.input_schema)
    if(row.name==='page_prepare')schema.properties.detail.default='image'
    register('gwz_'+row.name,guide.purpose+' 返回：'+guide.returns+' 后续：'+guide.next.join('、'),schema,
      (args,exec)=>controller.remote(row.name,args,exec),guide.title)
  }
  register('gwz_check','检查 CLI 登录、健康和连接，不跑全资源校验或模型。未登录时由用户在终端运行 guwenzi-tools login，不向模型提供密钥。',helperSchemas.gwz_check,async(_args,exec)=>{
    const context=await controller.stage(exec,'连接检查')
    const value=await controller.run(context,['doctor','--quick'])
    return {status:'checked',summary:value.result||value,images:[]}
  },'检查 OpenGlyph 连接')
  register('gwz_catalog','查每个工具的用途、完整输入 Schema、返回字段、调用示例和后续动作；不是 OCR，也不运行模型。',helperSchemas.gwz_catalog,async args=>{
    if(args.tool_name){
      const row=catalog.tools.find(r=>r.name===args.tool_name)
      if(!row)throw new Error('工具不存在；使用不带 tool_name 的 gwz_catalog 列举。')
      return {status:'reference',schema_source:catalog.source,tool:row.name,...guides[row.name],input_schema:row.input_schema,images:[]}
    }
    return {status:'reference',schema_source:catalog.source,tools:catalog.tools.map(r=>({name:'gwz_'+r.name,title:guides[r.name].title,purpose:guides[r.name].purpose})),
      examples:'示例中的占位身份必须换成工具实际返回的 ID。每次远端调用还会用实时 Schema 再校验。',images:[]}
  },'查看工具接口说明')
  register('gwz_open','上传用户指定的本地 PDF/图像/Office 并登记身份。返回 document_id 或图像 asset_id；不会 OCR，不处理未指定页。文件发送到用户已登录的 OpenGlyph 服务，不读模型密钥。',helperSchemas.gwz_open,
    (args,exec)=>controller.open({kind:'document',...args},exec),'上传并登记文献')
  register('gwz_upload','仅上传用户指定文件，返回 input_key、sha256 与大小。随后把 input_key 交给 gwz_document_open 或 gwz_asset_import；一般任务直接 gwz_open 会自动完成两步。',helperSchemas.gwz_upload,
    (args,exec)=>controller.upload(args,exec),'上传文件')
  register('gwz_resume','按真实 job_id 恢复查询/等待。用于取消等待、掉线后的续接；不重复上传或 POST，不取消已接受的远端任务。',helperSchemas.gwz_resume,
    (args,exec)=>controller.resume({wait:true,...args},exec),'恢复已有任务')
  register('gwz_evidence','查看已有记录的后续候选/部件以及后续图页。原始 JSON 保留全部结果；按返回的 next_offset 继续，不把预览第一页当作完整结果。',helperSchemas.gwz_evidence,
    (args,exec)=>controller.evidence(args,exec),'查看后续证据')
  register('gwz_deliver','从已生成字体的实际造字记录交付 OTF、TTF、码位映射、可复制文字、嵌入字体 Word 和 LaTeX 包；不把中间PNG充当排印成果，不覆盖旧目录文件。比较状态如实保留，学术验收交给人。',helperSchemas.gwz_deliver,
    (args,exec)=>controller.deliver(args,exec),'交付排印字体与 LaTeX 包')
  ctx.systemPrompt.section({name:'openglyph-paleography',order:450,text:persona,interpolate:false})
  const raw=readFileSync(skillPath,'utf8')
  const body=raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u,'')
  ctx.skills.register({name:'openglyph-paleography',description:'古文字原形/隶定字的证据采集、字形检索、结构造字和字体/LaTeX排印；不是通用OCR。',
    source:'bundled',path:skillPath,content:body,resourceBase:{kind:'directory',path:fileURLToPath(new URL('../skills/openglyph-paleography/',import.meta.url))}})
}
