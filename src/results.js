/** Compact, explicitly paged observations; original results stay in receipts. */
const fields = ['document_id','page','pages','source_sha256','source_asset_id','source_size_px','coordinate_space',
  'route','page_asset','asset','search_id','binding_id','gwz_code','code','glyph_ref','program','inspected_node',
  'preprocessing','bbox_px','roi_bbox_px','candidate_count','total_candidates','next_offset','diagnostics',
  'recognition_status','content_verified','all_ok','batch','writing_mode','reading_order_verified']

export function summary(result, offset, size) {
  const value = Object.fromEntries(fields.filter(k => k in result).map(k => [k,result[k]]))
  const pagination = {}
  for (const key of ['candidates','nodes','blocks','items','regions','lines']) {
    if (!Array.isArray(result[key])) continue
    value[key] = result[key].slice(offset,offset+size)
    pagination[key] = { total:result[key].length, offset, next_offset:offset+size<result[key].length?offset+size:null }
  }
  if (result.print_font) {
    value.print_font = { ...result.print_font }
    if (result.print_font.glyphs) {
      value.print_font.glyphs=result.print_font.glyphs.slice(offset,offset+size)
      pagination.font_glyphs={total:result.print_font.glyphs.length,offset,next_offset:offset+size<result.print_font.glyphs.length?offset+size:null}
    }
  }
  if (Object.keys(pagination).length) value.pagination=pagination
  return value
}

/** Select existing image assets, retaining every remaining reference for later pages. */
export function previewRefs(result) {
  const refs=[]
  const add=(record,label)=>{
    if(record?.asset_id && !refs.some(r=>r.asset.asset_id===record.asset_id)) refs.push({asset:record,label})
  }
  for(const key of ['page_asset','context_asset','whole_asset','contact_sheet_asset','overlay_asset','render_asset','difference_asset','asset']) add(result[key],key)
  for(const [index,row] of (result.contact_sheets||[]).entries()) add(row.contact_sheet_asset,'候选图页 '+(index+1))
  if(!refs.some(r=>r.label.includes('sheet')||r.label.startsWith('候选图页'))) {
    for(const row of result.candidates||[]) add(row.asset,row.candidate_id||row.glyph_name||'候选')
    for(const row of result.nodes||[]) add(row.asset,row.node)
  }
  if(result.print_font) add(result.print_font.preview_asset,'排印字体预览（尚待原图核验）')
  return refs.filter(({asset})=>!asset.path || /\.(png|jpe?g|webp|gif|tiff?|bmp|pgm)$/i.test(asset.path))
}

/** Pure renderer: canonical structured values and durable attachments remain distinct. */
export function render(_args,value) {
  const {images=[],result: _full,...visible}=value
  return [{type:'text',text:JSON.stringify({...visible,image_descriptions:images.map((image,index)=>({index:index+1,label:image.label,asset_id:image.asset_id}))})},
    ...images.map(image=>({type:'image',attachment:image.attachment}))]
}
