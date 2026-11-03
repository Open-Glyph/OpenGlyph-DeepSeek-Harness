/** Model-facing DSH subset plus strict validation of the complete server schema. */
import Ajv from 'ajv/dist/2020.js'

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
const retained = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])

/** Inline public schema definitions and retain only keywords understood by DSH PTC. */
export function modelSchema(schema, root = schema, seen = new Set()) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/$defs/') || seen.has(schema.$ref)) throw new Error('Unsupported recursive/external tool schema reference')
    const name = schema.$ref.slice(8).replace(/~1/g, '/').replace(/~0/g, '~')
    if (!root.$defs?.[name]) throw new Error('Missing schema definition: ' + name)
    return modelSchema(root.$defs[name], root, new Set([...seen, schema.$ref]))
  }
  const result = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!retained.has(key)) continue
    if (key === 'properties') result.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, modelSchema(v, root, seen)]))
    else if (key === 'items') result.items = modelSchema(value, root, seen)
    else if (key === 'additionalProperties') result.additionalProperties = value === false ? false : true
    else result[key] = value
  }
  if (schema.anyOf) result.oneOf = schema.anyOf.map(s => modelSchema(s, root, seen))
  const constraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']
    .filter(key => key in schema).map(key => key + '=' + schema[key])
  if (constraints.length) result.description = [result.description, 'Validated constraints: ' + constraints.join(', ')].filter(Boolean).join(' ')
  // Root cross-field rules (e.g. crop's batch/single oneOf) remain enforced by
  // the full AJV schema. DSH's exact-one branches cannot express `not`/`anyOf`.
  return result
}

/** Compile the full published schema, including ranges, $defs and cross-field rules. */
export function validator(schema) {
  const validate = ajv.compile(schema)
  // Live schemas are parsed afresh. Keep the compiled function, not every
  // request's schema object in AJV's process-global schema cache.
  ajv.removeSchema(schema)
  return value => {
    if (!validate(value)) throw new Error('参数不符合工具接口：' + ajv.errorsText(validate.errors, { separator: '; ' }))
    return value
  }
}

/** Pydantic model_validator rules are NOT included in JSON Schema; retain them explicitly. */
export function validateCall(tool,args) {
  const present=(value,key)=>value[key]!==undefined&&value[key]!==null
  if(tool==='glyph_compose') {
    const one=(value,batch=false)=>{
      const selectors=['glyph','ids','structure','program','proposal_id',...(batch?['items']:[])]
      if(selectors.filter(key=>present(value,key)).length!==1) throw new Error('造字必须且只能提供 glyph、ids、structure、program、proposal_id 或顶层 items 中的一种。')
      if(present(value,'fit_nodes')&&(!present(value,'program')||!present(value,'hint_asset_id'))) throw new Error('fit_nodes 需要 program 与 hint_asset_id。')
      if(present(value,'proposal_id')&&!present(value,'hint_asset_id')) throw new Error('proposal_id 必须附同一原图 hint_asset_id。')
    }
    one(args,true)
    if(args.items){
      if(present(args,'hint_asset_id')||present(args,'unicode_codepoint')) throw new Error('批量造字的 hint_asset_id / unicode_codepoint 必须放在每个 item 内。')
      for(const item of args.items)one(item)
    }
  }
  if(tool==='glyph_search'||tool==='glyph_template_search') {
    if(present(args,'asset_id')===present(args,'asset_ids')) throw new Error('只提供 asset_id 或 asset_ids 中的一种。')
    if(tool==='glyph_search'&&args.asset_ids&&present(args,'expand_search_id')) throw new Error('检索扩展仅用于单个 search_id。')
  }
  return args
}
