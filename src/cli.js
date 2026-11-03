/** Fixed-argv CLI transport through DSH's lifecycle-owned subprocess service. */
import { createWriteStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseWireJson } from './json-boundary.js'

export class CliFailure extends Error {
  constructor(message, details) { super(message); this.name = 'OpenGlyphCliError'; this.details = details }
}

export class Cli {
  constructor(runtime, config) { this.runtime = runtime; this.config = config }

  /** Execute once, saving complete streams on disk. No shell, POST replay, or task deadline. */
  async run(arguments_, { cwd, directory, signal, input }) {
    signal?.throwIfAborted()
    const executable = await this.runtime.resolveExecutable(this.config.cli, undefined, signal)
      .catch(() => { throw new CliFailure('找不到 guwenzi-tools。请先安装：python3 -m pip install -U guwenzi-tools；再运行 guwenzi-tools login。', { code: 'cli_missing' }) })
    const stem = join(directory, randomUUID())
    const stdout = stem + '.stdout.json', stderr = stem + '.stderr.log'
    const options = this.config.profile ? ['--profile', this.config.profile] : []
    const process = this.runtime.spawn({
      argv: [executable, '--quiet', ...options, ...arguments_], cwd, signal,
      stdio: { stdin: input === undefined ? 'ignore' : { data: JSON.stringify(input) }, stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.config.cancelGraceMs,
    })
    // Full streams are retained, not capped or silently truncated into invalid JSON.
    // The provider scrubs ambient model/API credentials from child environments.
    const drains = [pipeline(process.stdout, createWriteStream(stdout, { flags: 'wx', mode: 0o600 })),
      pipeline(process.stderr, createWriteStream(stderr, { flags: 'wx', mode: 0o600 }))]
    let outcome
    try { [outcome] = await Promise.all([process.done, ...drains]) }
    catch (error) { process.terminate(); await Promise.allSettled([process.done, ...drains]); throw error }
    signal?.throwIfAborted()
    let value
    try { value = parseWireJson(await readFile(stdout, 'utf8')) }
    catch(error) { throw new CliFailure(error instanceof SyntaxError?'CLI 没有返回完整 JSON；查看本地日志，不要重复提交结果未知的任务。':error.message,
      { code: 'invalid_cli_response', stdout, stderr }) }
    if (outcome.exitCode !== 0 || value.ok === false) {
      throw new CliFailure(value.error?.message || 'CLI 调用失败', { ...value.error, stdout, stderr })
    }
    return value
  }
}

/** Private immutable receipts are separate from model-facing compact summaries. */
export async function receipt(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return path
}
