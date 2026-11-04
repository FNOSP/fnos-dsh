import type { OptionValues } from 'commander'

export function addBooleanArgs(args: string[], options: OptionValues, names: string[]): void {
  for (const name of names) {
    if (options[name]) args.push(`--${name}`)
  }
}

export function addOptionalValueArg(args: string[], options: OptionValues, name: string): void {
  if (options[name] === undefined) return
  args.push(`--${name}`)
  if (typeof options[name] === 'string') args.push(options[name])
}

export function addNegatedArgs(args: string[], options: OptionValues, values: Array<[string, string]>): void {
  for (const [property, flag] of values) {
    if (options[property] === false) args.push(flag)
  }
}

/**
 * 把可重复选项的每个取值都还原成一次 `--flag <value>`。
 *
 * commander 侧用 collect 回调把重复出现收成数组；这里逐个写回，保证交互层拿到的
 * 参数串与非交互执行时形状一致。「取最后一个」会少产一份包且不报错，所以不能复用
 * `addOptionalValueArg`。
 */
export function addRepeatableValueArgs(args: string[], options: OptionValues, name: string): void {
  const value = options[name]
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  for (const item of values) {
    if (typeof item !== 'string') continue
    args.push(`--${name}`, item)
  }
}
