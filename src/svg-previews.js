/** Raster contact sheets derived from the library's real component SVGs. */
import { readFile,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')

export async function componentSheets(directory,value,attachments,{offset=0,pageSize=4}={}) {
  const choices=[['whole.svg','Whole glyph'],['parent.svg','Parent: '+(value.node||'root')],
    ...(value.nodes||[]).map((row,index)=>['node-'+index+'.svg',row.node])]
  const entries=[]
  for(const [file,label] of choices){
    try{entries.push({label,svg:(await readFile(join(directory,file),'utf8')).replace(/<\?xml[^>]*>/g,'')})}
    catch(error){if(error.code!=='ENOENT')throw error}
  }
  const sheets=[]
  for(let start=0;start<entries.length;start+=20){
    const rows=entries.slice(start,start+20),width=960,height=260*Math.ceil(rows.length/4)
    const body=rows.map((row,index)=>{
      const x=index%4*240,y=Math.floor(index/4)*260
      return '<g transform="translate('+x+','+y+')"><rect width="239" height="259" fill="white" stroke="#bbb"/>'
        +'<text x="8" y="22" font-size="14" font-family="monospace">'+escape(row.label)+'</text>'
        +'<g transform="translate(20,38)">'+row.svg+'</g></g>'
    }).join('')
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'">'+body+'</svg>'
    const bytes=new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng()
    const path=join(directory,'components-'+(sheets.length+1)+'.png')
    await writeFile(path,bytes,{flag:'wx'})
    sheets.push({path,labels:rows.map(row=>row.label),bytes})
  }
  const images=[]
  for(const [index,row] of sheets.slice(offset,offset+pageSize).entries()){
    const label='部件编号图页 '+(offset+index+1)
    const attachment=await attachments.saveImage({data:row.bytes,mediaType:'image/png',name:label+'.png'})
    images.push({label,attachment})
  }
  return {images,sheets:sheets.map(({bytes,...row})=>row),image_pagination:{total:sheets.length,offset,next_offset:offset+images.length<sheets.length?offset+images.length:null}}
}
