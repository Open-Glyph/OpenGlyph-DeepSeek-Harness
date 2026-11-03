/** Generate customer-readable field/return reference from the shipped source of truth. */
import { readFile,writeFile,mkdir } from 'node:fs/promises'
const root=new URL('../',import.meta.url)
const catalog=JSON.parse(await readFile(new URL('data/service-tools.json',root),'utf8'))
const guides=JSON.parse(await readFile(new URL('data/tool-guides.json',root),'utf8'))
let text='# 工具输入、输出与调用参考\n\n由公开工具 Schema 与插件用途说明生成；每次远端执行前还会用实时 Schema 校验。示例中的文字身份说明是占位提示，必须换为工具实际返回的 ID，不能逐字照抄。\n\n'
text+='所有工具名为 `gwz_` + 下列服务端名称。规范返回保留 `status`、`job_id`、`full_json`、`result`，另有紧凑 `summary`、图像附件、分页与 `next_tools`。原始记录不因当前预览分页而丢失。\n\n'
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
await mkdir(new URL('docs/',root),{recursive:true})
await writeFile(new URL('docs/TOOLS.md',root),text.trimEnd()+'\n')
console.log('Generated docs/TOOLS.md for '+catalog.tools.length+' tools.')
