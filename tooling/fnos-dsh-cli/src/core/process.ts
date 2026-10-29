import { execFile, spawn } from 'node:child_process'

export type RunCommandOptions = {
  /** Replacement environment for the child; defaults to the inherited one. */
  env?: NodeJS.ProcessEnv
}

export function runCommand(command: string, args: string[], cwd: string, options: RunCommandOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      ...(options.env === undefined ? {} : { env: options.env }),
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}

/**
 * 捕获命令的 stdout，用于读取 git 这类需要回读结果的小查询。
 *
 * 失败返回 `undefined` 而不是抛错：调用方通常有「取不到就退回另一来源」的分支
 * （`git describe` 在未打 tag 的提交上必然非零退出，那是正常状态而非错误）。
 */
export function captureCommandOutput(command: string, args: string[], cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile(command, args, { cwd }, (error, stdout) => {
      resolve(error === null ? stdout : undefined)
    })
  })
}
