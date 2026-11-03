import test from 'node:test'
import assert from 'node:assert/strict'
import { toolJson,parseWireJson } from '../src/json-boundary.js'
import { Context } from '@deepseek-ai/cordis'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

test('Python negative-zero page transform crosses the real DSH boundary without changing geometry',async()=>{
  const raw='{"status":"complete","result":{"page":40,"image_to_pdf_transform":[0.24,0,-0.0,0.24,0,0]}}'
  const source=JSON.parse(raw),corrected=parseWireJson(raw)
  assert.equal(Object.is(source.result.image_to_pdf_transform[2],-0),true)
  assert.equal(Object.is(corrected.result.image_to_pdf_transform[2],-0),false)
  for(let x=-20;x<=20;x++)for(let y=-20;y<=20;y++){
    const transform=m=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]
    assert.deepEqual(transform(corrected.result.image_to_pdf_transform),transform(source.result.image_to_pdf_transform))
  }
  const ctx=new Context();await ctx.plugin(Prompt);await ctx.plugin(Tools)
  let value=source
  try{
    ctx.tools.register({name:'recorded_page',description:'Recorded Python page result',parameters:{type:'object',properties:{},additionalProperties:false},
      output:{schema:{type:'object',additionalProperties:true},render:(_args,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>value})
    const call=id=>ctx.tools.execute({callId:ToolCallId(id),name:'recorded_page',arguments:{},signal:new AbortController().signal})
    const failure=await call('original')
    assert.equal(failure.isError,true)
    assert.match(failure.content.find(b=>b.type==='text').text,/not lossless JSON/)
    value=toolJson(source)
    const success=await call('normalized')
    assert.equal(success.isError,false)
    assert.equal(success.value.result.page,40)
  }finally{await ctx.fiber.dispose()}
})

test('canonicalization is idempotent, detached and preserves JSON roundtrips across nested combinations',()=>{
  const scalars=[null,true,false,'','原形\u0000字','\ud800','gwz:…',0,-0,1,-1,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,Number.MAX_SAFE_INTEGER]
  for(const a of scalars)for(const b of scalars){
    const input={document_id:'d-test',nested:[a,{value:b,unknown:null}],bbox:[-0,a,0,b]}
    const normalized=toolJson(input)
    assert.deepEqual(toolJson(normalized),normalized)
    assert.deepEqual(JSON.parse(JSON.stringify(normalized)),normalized)
    assert.notEqual(normalized,input);assert.notEqual(normalized.nested,input.nested)
    assert.equal(normalized.nested[0],a===0?0:a)
    assert.equal(normalized.nested[1].value,b===0?0:b)
    assert.equal(Object.is(input.bbox[0],-0),true,'must not mutate original evidence')
  }
  const prototypeKey=JSON.parse('{"__proto__":{"safe":true},"constructor":"a","prototype":"b"}')
  assert.deepEqual(toolJson(prototypeKey),prototypeKey)
  assert.equal(Object.getPrototypeOf(toolJson(prototypeKey)),Object.prototype)
  const shared={x:1};assert.deepEqual(toolJson([shared,shared]),[{x:1},{x:1}])
})

test('unsupported values fail at their path instead of dropping data or turning numbers into null',()=>{
  const hole=Array(1),extra=[1];extra.note='extra'
  const cycle={};cycle.self=cycle
  const hidden={};Object.defineProperty(hidden,'hidden',{value:1})
  const accessor={get bad(){throw new Error('must not invoke getters')}}
  for(const bad of [undefined,NaN,Infinity,-Infinity,1n,()=>{},Symbol('x'),new Date(),new Map(),hole,extra,cycle,hidden,accessor]){
    assert.throws(()=>toolJson({result:{bad}}),error=>error instanceof TypeError&&error.message.includes('$["result"]["bad"]'))
  }
  assert.throws(()=>parseWireJson('{"result":{"bad":1e400}}'),/非有限数值/)
  assert.throws(()=>parseWireJson('{"unfinished":'),SyntaxError)
})
