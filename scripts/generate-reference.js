/** Generate customer-readable field/return reference from the shipped source of truth. */
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { latexTools } from '../src/latex-tools.js'
const root=new URL('../',import.meta.url)
const catalog=JSON.parse(await readFile(new URL('data/service-tools.json',root),'utf8'))
const guides=JSON.parse(await readFile(new URL('data/tool-guides.json',root),'utf8'))
let text='# 工具输入、输出与调用参考\n\n由公开工具 Schema 与插件用途说明生成；每次远端执行前还会用实时 Schema 校验。示例中的文字身份说明是占位提示，必须换为工具实际返回的 ID，不能逐字照抄。\n\n'
text+='统一入口 `/openglyph` 会加载完整使用流程。原子工具名为 `gwz_` + 下列服务端名称。远端规范返回保留 `status`、`job_id`、`full_json`、`result`，另有紧凑 `summary`、图像附件、分页与 `next_tools`。原始记录不因当前预览分页而丢失。\n\n'
for(const tool of catalog.tools){
  const g=guides[tool.name]
  text+='## gwz_'+tool.name+'：'+g.title+'\n\n'+g.purpose+'\n\n返回：'+g.returns+'\n\n'
  text+='| 参数 | 类型 | 必填 | 默认/说明 |\n|---|---|---|---|\n'
  for(const [key,value] of Object.entries(tool.input_schema.properties||{})){
    const type=value.type || value.anyOf?.map(x=>x.type||x.$ref?.split('/').at(-1)).join(' / ') || 'JSON'
    const def=key==='detail'&&tool.name==='page_prepare'?'image（插件默认）':('default'in value?JSON.stringify(value.default):'')
    text+='| `'+key+'` | '+type+' | '+((tool.input_schema.required||[]).includes(key)?'是':'否')+' | '+[def,value.description||''].filter(Boolean).join('；').replace(/\|/g,'\\|')+' |\n'
  }
  text+='\n调用参数示例：\n\n```json\n'+JSON.stringify(g.example,null,2)+'\n```\n\n后续工具：'+g.next.map(x=>'`'+x+'`').join('、')+'。\n\n'
}
text+='## 本地LaTeX工具（无需云账号）\n\n这些工具直接准备项目、操作随包字库、编译新字和PDF；不是远端OCR。首次依赖检查见setup。\n\n'
for(const tool of latexTools){
  text+='### '+tool.name+'：'+tool.title+'\n\n'+tool.description+'\n\n'
  text+='| 参数 | 必填 | 说明 |\n|---|---|---|\n'
  for(const [key,value] of Object.entries(tool.parameters.properties))text+='| `'+key+'` | '+(tool.parameters.required.includes(key)?'是':'否')+' | '+(value.description||('默认 '+JSON.stringify(value.default))).replace(/\|/g,'\\|')+' |\n'
  text+='\n'
}
await mkdir(new URL('docs/',root),{recursive:true})
await writeFile(new URL('docs/TOOLS.md',root),text.trimEnd()+'\n')
console.log('Generated docs/TOOLS.md for '+catalog.tools.length+' tools.')
