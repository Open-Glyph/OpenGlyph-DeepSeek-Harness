/** Native schemas double as the model's executable LaTeX instructions. */
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false})
const string=description=>({type:'string',minLength:1,description})
const offset={type:'integer',minimum:0,default:0}

export const latexTools=[
  {name:'gwz_latex_setup',method:'setup',title:'检查/准备本地排印环境',
    description:'检查随包22,583字字库、Tectonic/XeLaTeX、Python/Node和字体检查依赖，逐项报告可用能力。install_dependencies=true 时只在当前工作文件夹创建独立Python环境并安装离线构字/PDF检查依赖，不改全局、不装操作系统编译器、不调用云模型。普通已有字排印不需要构字依赖。',
    parameters:object({install_dependencies:{type:'boolean',default:false}})},
  {name:'gwz_latex_prepare',method:'prepare',title:'准备可编译的LaTeX论文项目',
    description:'将真实openglyph.sty、22,583字OTF/catalog和许可放进新项目，生成main.tex。可导入gwz_deliver返回的LaTeX字体ZIP，自动加载其catalog。返回project_dir与tex_file；不覆盖已有论文。不需要账号或云调用。随后编辑正文并调用gwz_latex_compile。',
    parameters:object({project_dir:string('当前工作文件夹内的新目录，如 outputs/论文排印。必须尚不存在。'),
      title:{type:'string',description:'论文标题，作为文字安全转义；不是TeX代码。'},font_bundle:string('可选：服务实际交付的LaTeX字体ZIP，必须在工作文件夹中。')},['project_dir'])},
  {name:'gwz_latex_lookup',method:'lookup',title:'查询随包字库的排印编号',
    description:'离线查来源编号、GlyphWiki名或部件，返回精确的\\ebag{s030-067}等排印命令及未核定状态，不猜学术读法。query省略时分页列举全部22,583字；不是图像相似度检索。图像检索请用glyph_template_search；下一步可本地inspect部件。',
    parameters:object({query:{type:'string',default:'',description:'如 s030-067、ebag:s030-067、ebag_s030-067、u81e4、U+81E4 或已知部件字符。'},offset})},
  {name:'gwz_latex_inspect',method:'inspect',title:'查看离线底字与编号部件',
    description:'对随包底字运行真实KAGE部件检查并返回编号预览，不需要云账号。base用实际查询到的ebag:编号；逐层展开node，不能猜部件编号。无需fonttools/pathops，仅需Python和Node。查看后再编辑高层JSON，不写底层KAGE。',
    parameters:object({base:string('如 ebag:s030-067；须先查到并看形。'),node:{type:'string',default:'root'},image_offset:offset},['base'])},
  {name:'gwz_latex_build',method:'build',title:'把JSON新字项目编译成OTF和LaTeX目录',
    description:'编译openglyph.project.v1的namespace/glyphs/base/edits/modules/select为真实OTF、catalog.tex、allocation.json及来源。支持换部件、饰笔、删笔、比例调整。先实际inspect编号；输出目录必须新建。返回\\OpenGlyphLoad和\\gwglyph命令；生成不代表人工核定。依赖不足先latex_setup。远端glyph_compose及旧IDS路线仍可并行。',
    parameters:object({project_file:string('已用DSH文件工具写好的JSON项目文件；建议与main.tex同目录。'),
      output_dir:string('新字库目录，如 outputs/论文/myglyphs；不能覆盖旧目录。'),allocation_file:string('可选旧allocation.json，修订字库时保留已分配码位。')},['project_file','output_dir'])},
  {name:'gwz_latex_compile',method:'compile',title:'编译论文PDF并检查缺字与字体',
    description:'真正编译指定.tex到新的PDF，不是只下载ZIP。用Tectonic --untrusted或XeLaTeX -no-shell-escape，遵守宿主命令沙箱；不设任务总时限。保留完整日志、旧PDF，报告缺字/未知编号/溢出、页数与可用的字体嵌入检查。返回PDF路径；编译成功不等于字形/释读核定。不要用pdfLaTeX。',
    parameters:object({tex_file:string('工作文件夹中的.tex源码；一般是latex_prepare返回的tex_file。'),
      allow_downloads:{type:'boolean',description:'允许Tectonic按需下载TeX资源；false仅使用已缓存资源。默认按插件配置。'}},['tex_file'])},
]
