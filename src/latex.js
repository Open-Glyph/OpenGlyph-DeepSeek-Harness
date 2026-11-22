/** Full local LaTeX path: prepare resources, build named fonts and compile PDFs. */
import { readFile,writeFile,mkdir,copyFile,stat,access } from 'node:fs/promises'
import { join,dirname,basename,relative,delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { Commands } from './commands.js'
import { constants } from 'node:fs'
import { materialize,resourceManifest,fileHash } from './latex-resources.js'
import { inputFile,outputDirectory,workspacePath } from './paths.js'
import { componentSheets } from './svg-previews.js'

const bridgeSource=new URL('../runtime/latex_bridge.py',import.meta.url)
const requirementsSource=new URL('../runtime/requirements.txt',import.meta.url)
const probe='import sys,json,importlib.util;print(json.dumps({"version":list(sys.version_info[:3]),"modules":{x:importlib.util.find_spec(x) is not None for x in ["fontTools","pathops","pymupdf","fitz","pypdf","pip"]}}))'
const allowedName=/^[A-Za-z][A-Za-z0-9._-]*$/
const texEscape=text=>String(text).replace(/[\\{}$&#%_^~]/g,ch=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','$':'\\$','&':'\\&','#':'\\#','%':'\\%','_':'\\_','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[ch]))
const present=path=>access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})

export class Latex {
  constructor(ctx,config,controller){this.ctx=ctx;this.config=config;this.controller=controller;this.commands=new Commands(ctx,config)}

  async stage(exec,label){return this.controller.stage(exec,label)}
  async runtime(context){return outputDirectory(context.cwd,this.config.latexRuntimeDirectory)}

  async python(context) {
    const runtime=await this.runtime(context)
    return this.commands.resolve([join(runtime,'python',process.platform==='win32'?'Scripts/python.exe':'bin/python'),this.config.python,
      join(homedir(),'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3')],context.signal)
  }

  async helper(context,python) {
    const root=await this.runtime(context),raw=await readFile(bridgeSource)
    const hash=createHash('sha256').update(raw).digest('hex')
    const target=join(root,'latex-bridge-'+hash.slice(0,16)+'.py')
    if(await present(target)){
      if(await fileHash(target)!==hash)throw new Error('本地 PDF/字体包助手已改变，未执行。')
    }else await writeFile(target,raw,{flag:'wx',mode:0o600})
    return target
  }

  async json(argv,context,options) {
    const result=await this.commands.run(argv,context,{...options,fullOutput:true})
    if(result.exit_code!==0)throw Object.assign(new Error('本地排印命令失败：'+result.diagnostic_tail),{details:{stdout:result.stdout,stderr:result.stderr}})
    try{return JSON.parse(result.out)}catch{throw new Error('本地排印助手没有返回有效 JSON；完整日志：'+result.stdout)}
  }

  async setup(args,exec) {
    const context=await this.stage(exec,'排印环境自检')
    const compiler=await this.compiler(context)
    const node=await this.commands.resolve([this.config.node,process.versions.electron?null:process.execPath,
      join(homedir(),'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node')],context.signal)
    let python=await this.python(context),pythonInfo=null
    if(python)pythonInfo=await this.json([python,'-c',probe],context)
    if(args.install_dependencies){
      if(!python||pythonInfo.version[0]<3||(pythonInfo.version[0]===3&&pythonInfo.version[1]<10))throw new Error('离线构字需要 Python3.10+；请配置 python 路径。')
      const runtime=await this.runtime(context),venv=join(runtime,'python'),marker=join(runtime,'python-owner.json')
      if(await present(venv)&&!await present(marker))throw new Error('构字环境目录已存在但不是本插件创建，未覆盖：'+venv)
      if(!await present(marker))await writeFile(marker,JSON.stringify({owner:'openglyph.dsh',base_python:python})+'\n',{flag:'wx',mode:0o600})
      const make=await this.commands.run([python,'-m','venv',venv],context)
      if(make.exit_code!==0)throw new Error('独立 Python 环境创建失败，未改全局环境：'+make.diagnostic_tail)
      python=join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python')
      const requirement=join(runtime,'requirements.txt')
      await copyFile(requirementsSource,requirement)
      const install=await this.commands.run([python,'-m','pip','install','--disable-pip-version-check','--no-cache-dir','-r',requirement],context)
      if(install.exit_code!==0)throw new Error('独立环境依赖安装失败；完整日志：'+install.stderr+'\n'+install.diagnostic_tail)
      pythonInfo=await this.json([python,'-c',probe],context)
    }
    const capabilities={existing_glyph_catalog:true,prepare_project:true,compile_pdf:Boolean(compiler),
      offline_inspect:Boolean(python&&node),offline_font_build:Boolean(python&&node&&pythonInfo?.modules.fontTools&&pythonInfo?.modules.pathops),
      pdf_font_inspection:Boolean(pythonInfo?.modules.pymupdf||pythonInfo?.modules.fitz||pythonInfo?.modules.pypdf)}
    const fixes=[]
    if(!compiler)fixes.push('未找到 Tectonic/XeLaTeX；安装其中一个后，在插件设置中配置 tectonic/xelatex 的绝对路径。')
    if(!capabilities.offline_font_build)fixes.push('需要离线造新字时，可调用 gwz_latex_setup(install_dependencies=true)；只在当前工作文件夹创建虚拟环境。已有字体排印不需要这一步。')
    if(!node)fixes.push('离线构字需要独立 Node 可执行文件；请配置 node，不能把 Electron 应用主程序当作 Node。')
    return {status:Object.values(capabilities).every(Boolean)?'ready':'partial',capabilities,compiler,python,python_info:pythonInfo,node,
      bundled_library:{version:resourceManifest.source_version,glyph_count:resourceManifest.glyph_count,source_commit:resourceManifest.source_commit},
      fixes,images:[],cloud_calls:0,global_environment_changed:false}
  }

  async compiler(context) {
    for(const engine of this.config.latexEngine==='auto'?['tectonic','xelatex']:[this.config.latexEngine]) {
      const path=await this.commands.resolve([this.config[engine],'/opt/homebrew/bin/'+engine,'/usr/local/bin/'+engine],context.signal)
      if(path)return {engine,path}
    }
    return null
  }

  async library(context){return materialize(context.cwd,this.config)}

  async ocr(args,exec) {
    const context=await this.stage(exec,'OCR排印'),root=await this.library(context)
    const python=await this.python(context)
    if(!python)throw new Error('OCR排印需要Python和fonttools；先运行gwz_latex_setup。')
    const source=await inputFile(context.cwd,args.source_file)
    const output=await workspacePath(context.cwd,args.project_dir)
    if(await present(output))throw new Error('OCR项目目录已存在，请选择新目录；合成任务中断时用gwz_resume恢复，再把full_json传入composition_file。')
    const command=[python,join(root,'scripts/openglyph.py'),'ocr',source]
    if(args.text_font)command.push('--text-font',await inputFile(context.cwd,args.text_font,this.config.additionalInputRoots))
    const plan=await this.json([...command,'--plan','-o',join(context.directory,'plan.json')],context)
    const resolution={aliases:{},bundles:[]}
    if(plan.requirements.length) {
      const items=plan.requirements.map(row=>row.arguments)
      let composed
      if(args.composition_file){
        const {record,path}=await this.controller.stored(args.composition_file,exec)
        const request=record.envelope.request
        if(record.tool!=='glyph_compose'||request?.name!=='glyph_compose'||
           JSON.stringify(request.arguments?.items)!==JSON.stringify(items)||record.envelope.ok!==true||record.envelope.status!=='complete'){
          throw new Error('恢复记录与本次OCR字形需求不一致；没有提交新合成任务。')
        }
        composed={result:record.envelope.result,full_json:path}
      }else composed=await this.controller.remote('glyph_compose',{items},exec)
      const value=composed.result,pack=value.print_font,rows=value.items||[]
      if(value.all_ok!==true||pack?.status!=='ready'||pack.all_items_included!==true||
         rows.length!==plan.requirements.length||new Set(rows.map(row=>row.index)).size!==rows.length||
         rows.some(row=>row.ok!==true||!Number.isInteger(row.index)||row.index<0||row.index>=rows.length)){
        throw new Error('OCR字形未全部生成，结果保留：'+composed.full_json)
      }
      const byCode=new Map(pack.latex_aliases.map(row=>[row.code,row.alias]))
      for(const row of rows){
        const alias=byCode.get(row.result.gwz_code)
        if(!alias)throw new Error('字体没有对应返回的字形身份：'+composed.full_json)
        resolution.aliases[plan.requirements[row.index].key]=alias
      }
      const bundle=join(context.directory,'font-bundle.zip')
      await this.controller.run(context,['asset',pack.bundle_asset.asset_id,'--output',bundle])
      resolution.bundles.push({path:bundle,aliases:[...new Set(Object.values(resolution.aliases))]})
    }
    const mapping=join(context.directory,'resolution.json')
    await writeFile(mapping,JSON.stringify(resolution,null,2)+'\n',{flag:'wx',mode:0o600})
    const result=await this.json([...command,'--resolution',mapping,'-o',output],context)
    return {status:'ocr_project_ready',...result,images:[],next_tools:['gwz_latex_compile'],
      note:'已保留OCR原文、标记和字体映射，第二候选未替换正文；编译PDF后仍需对照原图校对。'}
  }

  async lookup(args,exec) {
    const context=await this.stage(exec,'查询排印字库'),root=await this.library(context)
    const metadata=JSON.parse(await readFile(join(root,'ebag/manifest.json'),'utf8'))
    const query=(args.query||'').trim()
    const queries=[query]
    if(Array.from(query).length===1&&query.codePointAt(0)>127)queries.push('u'+query.codePointAt(0).toString(16))
    if(/^U\+[0-9A-Fa-f]+$/.test(query))queries.push('u'+parseInt(query.slice(2),16).toString(16))
    const rows=metadata.glyphs.filter(row=>!query||[row.id,row.alias,row.glyphwiki_name,...(row.components||[])].some(x=>queries.some(q=>x===q||x.includes(q))))
    const offset=args.offset||0,page=rows.slice(offset,offset+this.config.resultPageSize)
    return {status:'catalog',total:rows.length,offset,next_offset:offset+page.length<rows.length?offset+page.length:null,
      glyphs:page.map(row=>({id:row.id,alias:row.alias,glyphwiki_name:row.glyphwiki_name,components:row.components,
        latex:'\\ebag{'+row.id+'}',unicode_identity_verified:false,source_equivalence_verified:false})),
      query,query_forms:queries,library_version:resourceManifest.source_version,images:[],next_tools:['gwz_latex_inspect','gwz_latex_prepare']}
  }

  async prepare(args,exec) {
    const context=await this.stage(exec,'准备LaTeX论文'),root=await this.library(context)
    const path=await workspacePath(context.cwd,args.project_dir)
    if(await present(path))throw new Error('论文项目目录已存在；请选择新目录，避免覆盖已有论文：'+path)
    const project=await outputDirectory(context.cwd,args.project_dir)
    for(const relativeName of ['openglyph.sty','ebag/catalog.tex','ebag/OpenGlyphEbag.otf','ebag/manifest.json','licenses/GlyphWiki.txt','LICENSE','THIRD-PARTY-NOTICES.md']){
      const target=join(project,relativeName);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,relativeName),target)
    }
    let custom=[]
    if(args.font_bundle){
      const python=await this.python(context)
      if(!python)throw new Error('导入服务生成的 ZIP 字体包需要 Python；项目已保留，可改用已有字库继续。')
      const zip=await inputFile(context.cwd,args.font_bundle)
      await this.json([python,await this.helper(context,python),'unpack',zip,join(project,'generated')],context)
      const catalog=await readFile(join(project,'generated/catalog.tex'),'utf8')
      custom=[...catalog.matchAll(/\\OpenGlyphDeclare(?:Entry)?\{([A-Za-z][A-Za-z0-9:._-]*)\}/g)].map(m=>m[1])
    }
    const source=String.raw`\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage[a4paper,margin=25mm]{geometry}
\usepackage{openglyph}
\OpenGlyphLoad{ebag}
`+(args.font_bundle?'\\OpenGlyphLoad{generated}\n':'')+String.raw`\title{`+texEscape(args.title||'古文字论文排印候选稿')+String.raw`}
\author{}
\date{}
\begin{document}
\maketitle
已有字形可直接排进正文：\ebag{s030-067}、\ebag{s131-009}。
`+(custom.length?'本次生成的字形：'+custom.slice(0,4).map(id=>'\\gwglyph{'+id+'}').join('、')+'。\n':'')+String.raw`
% 将正文写在这里；新字库生成后先 \OpenGlyphLoad{myglyphs} 再 \gwglyph{my:n1}。
% 字体编译成功不表示字形或学术释读已由人核定。
\end{document}
`
    const tex=join(project,'main.tex')
    await writeFile(tex,source,{flag:'wx',mode:0o600})
    await writeFile(join(project,'openglyph-project.json'),JSON.stringify({schema:'openglyph.dsh.latex-project.v1',source_commit:resourceManifest.source_commit,
      library_version:resourceManifest.source_version,font_sha256:resourceManifest.font_sha256,human_approved:false},null,2)+'\n',{flag:'wx'})
    return {status:'prepared',project_dir:project,tex_file:tex,glyph_count:resourceManifest.glyph_count,generated_aliases:custom,
      next_step:'用 DSH 文件编辑工具写 main.tex，然后调用 gwz_latex_compile。',commands:{load_existing:'\\OpenGlyphLoad{ebag}',existing:'\\ebag{s030-067}',custom:'\\gwglyph{my:n1}'},images:[]}
  }

  async build(args,exec) {
    const context=await this.stage(exec,'编译自造字库'),root=await this.library(context)
    const python=await this.python(context)
    const node=await this.commands.resolve([this.config.node,process.versions.electron?null:process.execPath,
      join(homedir(),'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node')],context.signal)
    if(!python||!node)throw new Error('离线构字缺少 Python/Node；请先运行 gwz_latex_setup。')
    const project=await inputFile(context.cwd,args.project_file)
    const output=await workspacePath(context.cwd,args.output_dir)
    if(await present(output))throw new Error('新字库目录已存在，未覆盖。换一个 output_dir；更新地址时用旧 allocation_file。')
    const command=[python,join(root,'scripts/openglyph.py'),'build',project,'-o',output]
    if(args.allocation_file)command.push('--allocation',await inputFile(context.cwd,args.allocation_file))
    const built=await this.json(command,context,{env:{PATH:dirname(node)+delimiter+process.env.PATH}})
    const relativeFolder=relative(dirname(project),output).replaceAll('\\','/')
    return {status:'font_built',output_dir:output,manifest:built,
      latex_load:'\\OpenGlyphLoad{'+relativeFolder+'}',latex_load_relative_to:dirname(project),aliases:built.glyphs.map(row=>({id:row.id,latex:'\\gwglyph{'+row.alias+'}'})),
      warning:'这是新生成的可排印候选字，仍须对原图和最终字体比较、由人核定。',images:[],next_tools:['gwz_latex_compile']}
  }

  async inspect(args,exec) {
    const context=await this.stage(exec,'查看离线部件'),root=await this.library(context),python=await this.python(context)
    const node=await this.commands.resolve([this.config.node,process.versions.electron?null:process.execPath,
      join(homedir(),'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node')],context.signal)
    if(!python||!node)throw new Error('本地部件预览需要 Python 与 Node；先调用 gwz_latex_setup。')
    const output=join(context.directory,'components')
    const value=await this.json([python,join(root,'scripts/openglyph.py'),'inspect',args.base,'--node',args.node||'root','-o',output],context,
      {env:{PATH:dirname(node)+delimiter+process.env.PATH}})
    const sheets=await componentSheets(output,value,this.ctx.attachments,{offset:args.image_offset||0,pageSize:this.config.imagePageSize})
    return {status:'inspected',...value,...sheets,preview_html:join(output,'index.html'),preview_dir:output,
      next_tools:['gwz_latex_build','gwz_glyph_compose'],note:'node 是实际部件/记录编号，不是语义笔画名称；请查看预览后编辑。'}
  }

  async compile(args,exec) {
    const context=await this.stage(exec,'编译论文PDF')
    const source=await inputFile(context.cwd,args.tex_file)
    if(!source.toLowerCase().endsWith('.tex'))throw new Error('请选择 .tex 论文源码')
    const compiler=await this.compiler(context)
    if(!compiler)throw new Error('缺少 Tectonic/XeLaTeX。先运行 gwz_latex_setup 查看缺项并配置编译器路径。')
    const output=await outputDirectory(context.cwd,join(context.directory,'compiled'))
    const command=compiler.engine==='tectonic'?[compiler.path,'--untrusted','--keep-logs','--outdir',output,
      ...((args.allow_downloads??this.config.allowTexDownloads)?[]:['--only-cached']),'./'+basename(source)]:
      [compiler.path,'-no-shell-escape','-halt-on-error','-interaction=nonstopmode','-output-directory',output,'./'+basename(source)]
    const result=await this.commands.run(command,{...context,cwd:dirname(source)},
      {env:{openin_any:'p',openout_any:'p'}})
    const pdf=join(output,basename(source).replace(/\.tex$/i,'.pdf'))
    if(result.exit_code!==0||!await present(pdf))throw Object.assign(new Error('LaTeX 编译失败；没有把旧 PDF 当作新结果。\n'+result.diagnostic_tail),
      {details:{stdout:result.stdout,stderr:result.stderr,source,next_tools:['gwz_latex_lookup','gwz_latex_prepare']}})
    const {open}=await import('node:fs/promises')
    const handle=await open(pdf,'r'),header=Buffer.alloc(5)
    try{await handle.read(header,0,5,0)}finally{await handle.close()}
    if(header.toString()!=='%PDF-')throw new Error('编译器没有生成有效 PDF 文件头')
    let audit={status:'not_checked',reason:'未找到 Python PDF 检查器'}
    const python=await this.python(context)
    if(python)audit=await this.json([python,await this.helper(context,python),'audit',pdf],context)
    const logPath=join(output,basename(source).replace(/\.tex$/i,'.log'))
    const log=await readFile(logPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})
    const warnings=(log+'\n'+result.out+'\n'+result.err).split('\n').filter(line=>/Missing character:|does not contain glyph|Unknown glyph|Overfull \\hbox/.test(line))
    const destination=dirname(source),stem=basename(pdf,'.pdf')
    let final=join(destination,stem+'.pdf'),index=2
    while(true){
      try{await copyFile(pdf,final,constants.COPYFILE_EXCL);break}
      catch(error){if(error.code!=='EEXIST')throw error;final=join(destination,stem+'-'+index+++'.pdf')}
    }
    return {status:warnings.length?'compiled_needs_review':'compiled_draft',pdf:final,tex_file:source,engine:compiler.engine,
      pdf_audit:audit,warnings,stdout:result.stdout,stderr:result.stderr,tex_log:logPath,
      preserved_prior_pdfs:index>2,human_approval_recorded:false,faithfulness_verified:false,images:[],
      note:'已生成论文 PDF；编译、字体嵌入、字形一致性、学术释读是不同检查，后两项仍需实际证据及人工核定。'}
  }
}
