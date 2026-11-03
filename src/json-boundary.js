/** Canonical JSON at the service/DSH boundary, without lossy stringify tricks. */
export function toolJson(value) {
  const root={}
  const ancestors=new Set()
  const pending=[{source:value,target:root,key:'value',path:'$'}]
  const fail=(path,reason)=>{throw new TypeError('工具返回值不符合 JSON 契约：'+path+'（'+reason+'）。不要通过重复提交任务重试。')}
  const put=(target,key,item)=>Object.defineProperty(target,key,{value:item,enumerable:true,configurable:true,writable:true})
  while(pending.length){
    const task=pending.pop()
    if(task.leave){ancestors.delete(task.leave);continue}
    const {source,target,key,path}=task
    if(source===null||typeof source==='string'||typeof source==='boolean'){put(target,key,source);continue}
    if(typeof source==='number'){
      if(!Number.isFinite(source))fail(path,'非有限数值')
      // -0 is valid Python JSON but rejected by DSH's lossless snapshots.
      // Both signs represent the same zero displacement in our geometry.
      put(target,key,Object.is(source,-0)?0:source);continue
    }
    if(typeof source!=='object')fail(path,typeof source)
    if(ancestors.has(source))fail(path,'循环引用')
    const array=Array.isArray(source),prototype=Object.getPrototypeOf(source)
    if(array){
      if(!Array.isArray(prototype)||prototype.constructor?.name!=='Array')fail(path,'非普通数组')
      if(Reflect.ownKeys(source).length!==source.length+1)fail(path,'稀疏数组或额外数组属性')
    }else if(prototype!==null&&!(Object.getPrototypeOf(prototype)===null&&prototype.constructor?.name==='Object')){
      fail(path,'非普通 JSON 对象')
    }
    const keys=array?Array.from({length:source.length},(_,i)=>String(i)):Reflect.ownKeys(source)
    const copy=array?[]:{}
    put(target,key,copy);ancestors.add(source);pending.push({leave:source})
    for(let i=keys.length-1;i>=0;i--){
      const name=keys[i]
      if(typeof name!=='string')fail(path,'Symbol 属性')
      const childPath=path+(array?'['+name+']':'['+JSON.stringify(name)+']')
      const descriptor=Object.getOwnPropertyDescriptor(source,name)
      if(!descriptor||!descriptor.enumerable)fail(childPath,'缺失或不可枚举的属性')
      if(!Object.hasOwn(descriptor,'value'))fail(childPath,'访问器属性')
      pending.push({source:descriptor.value,target:copy,key:name,path:childPath})
    }
  }
  return root.value
}

/** Keep the original wire bytes on disk; canonicalize only the parsed value. */
export const parseWireJson=text=>toolJson(JSON.parse(text))
