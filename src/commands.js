/** Local build commands inherit the Harness shell's standing sandbox policy. */
import { readFile,open } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'"

export class Commands {
  constructor(ctx,config){this.ctx=ctx;this.config=config}

  async resolve(candidates,signal) {
    for(const candidate of [...new Set(candidates.filter(Boolean))]){
      signal?.throwIfAborted()
      try{return await this.ctx.subprocess.resolveExecutable(candidate,undefined,signal)}
      catch(error){if(signal?.aborted)throw error}
    }
    return null
  }

  /** No task deadline; complete stdout/stderr are files even if the shell's display spills. */
  async run(argv,context,{env={},fullOutput=false}={}) {
    context.signal?.throwIfAborted()
    const stdout=join(context.directory,randomUUID()+'.stdout.log')
    const stderr=join(context.directory,randomUUID()+'.stderr.log')
    const policyService=this.ctx.get?.('sandboxPolicy')
    if(this.ctx.shell.sandboxMode!==undefined&&!policyService)throw new Error('宿主启用了命令沙箱，但缺少 sandboxPolicy；没有运行编译。')
    const policy=policyService?.resolve(context.agent?{session:context.agent.session}:{})
    const command=argv.map(shellQuote).join(' ')+' > '+shellQuote(stdout)+' 2> '+shellQuote(stderr)
    const spec=this.ctx.shell.resolve({command,workdir:context.cwd,onExpiry:'none',signal:context.signal,env,
      ...(policy?{sandboxPolicy:policy}:{})})
    const running=await this.ctx.shell.execute(spec)
    const result=await running.result()
    const read=async path=>{
      if(fullOutput)return readFile(path,'utf8')
      const handle=await open(path,'r')
      try{
        const {size}=await handle.stat(),count=Math.min(size,this.config.diagnosticCharacters)
        const bytes=Buffer.alloc(count);await handle.read(bytes,0,count,size-count)
        return bytes.toString('utf8')
      }finally{await handle.close()}
    }
    const safeRead=path=>read(path).catch(error=>{
      if(error.code==='ENOENT')return ''
      throw error
    })
    const [out,err]=await Promise.all([safeRead(stdout),safeRead(stderr)])
    context.signal?.throwIfAborted()
    if(result.sandbox?.denied||result.sandbox?.runnerFailed)throw new Error('宿主命令沙箱拒绝了操作；未改用无沙箱执行。请核对工作文件夹授权。\n'+(result.stderr?.text||err))
    const combined=out+'\n'+err+'\n'+(result.stderr?.text||'')
    return {exit_code:result.exitCode,stdout,stderr,out,err,sandbox:result.sandbox||null,
      diagnostic_tail:combined.slice(-this.config.diagnosticCharacters),diagnostic_tail_is_excerpt:true}
  }
}
