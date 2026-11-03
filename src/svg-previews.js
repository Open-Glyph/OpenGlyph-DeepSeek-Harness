/** Raster contact sheets derived from the library's real component SVGs. */
import { readFile,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Resvg,initWasm } from '@resvg/resvg-wasm'

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const require=createRequire(import.meta.url)
let rendererReady,fontReady

async function initialize(){
  // The signed DSH desktop runtime rejects third-party native .node libraries.
  // WASM needs no code-signature changes and works in desktop and CLI profiles.
  rendererReady??=initWasm(readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
  await rendererReady
  fontReady??=(async()=>{
    const candidates=[['/System/Library/Fonts/Menlo.ttc','Menlo'],
      ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf','DejaVu Sans Mono'],
      ['/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf','DejaVu Sans Mono'],
      ['C:/Windows/Fonts/consola.ttf','Consolas']]
    for(const [path,family] of candidates){
      try{return {fontBuffers:[await readFile(path)],defaultFontFamily:family,monospaceFamily:family}}
      catch(error){if(error.code!=='ENOENT'&&error.code!=='EACCES')throw error}
    }
    return {fontBuffers:[]}
  })()
  return fontReady
}

// Font-independent numbered panels remain readable on fontless installations.
const digitSegments=['abcedf','bc','abged','abgcd','fgbc','afgcd','afgecd','abc','abcdefg','abfgcd']
const segments={a:[0,0,8,0],b:[8,0,8,6],c:[8,6,8,12],d:[0,12,8,12],e:[0,6,0,12],f:[0,0,0,6],g:[0,6,8,6]}
const badge=number=>'<g stroke="#222" stroke-width="1.3" fill="none">'+Array.from(String(number),(digit,i)=>
  '<path transform="translate('+(8+i*12)+',9)" d="'+Array.from(digitSegments[Number(digit)],s=>{
    const [x,y,x2,y2]=segments[s];return 'M'+x+' '+y+'L'+x2+' '+y2
  }).join('')+'"/>').join('')+'</g>'

export async function componentSheets(directory,value,attachments,{offset=0,pageSize=4}={}) {
  const font=await initialize()
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
        +badge(start+index+1)+'<text x="52" y="22" font-size="14" font-family="monospace">'+escape(row.label)+'</text>'
        +'<g transform="translate(20,38)">'+row.svg+'</g></g>'
    }).join('')
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'">'+body+'</svg>'
    const renderer=new Resvg(svg,{font})
    let rendered,bytes
    try{rendered=renderer.render();bytes=Buffer.from(rendered.asPng())}
    finally{rendered?.free();renderer.free()}
    const path=join(directory,'components-'+(sheets.length+1)+'.png')
    await writeFile(path,bytes,{flag:'wx'})
    sheets.push({path,labels:rows.map(row=>row.label),panels:rows.map((row,i)=>({number:start+i+1,label:row.label})),bytes})
  }
  const images=[]
  for(const [index,row] of sheets.slice(offset,offset+pageSize).entries()){
    const label='部件编号图页 '+(offset+index+1)
    const attachment=await attachments.saveImage({data:row.bytes,mediaType:'image/png',name:label+'.png'})
    images.push({label,attachment})
  }
  return {images,sheets:sheets.map(({bytes,...row})=>row),image_pagination:{total:sheets.length,offset,next_offset:offset+images.length<sheets.length?offset+images.length:null}}
}
