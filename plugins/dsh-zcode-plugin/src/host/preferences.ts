/**
 * 插件偏好的宿主侧持久化。
 *
 * 与凭据分开存放：偏好不是秘密，但也只由插件自己读写；损坏或字段漂移时
 * 回落到默认值，避免一个坏文件让详情页整块不可用。
 *
 * @module dsh-zcode/preferences
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_ZCODE_PREFERENCES,
  normalizePreferences,
  type ZCodePreferences,
} from '../contracts/preferences.ts'

/** 偏好文件名（位于 DSH home 下）。 */
export const ZCODE_PREFERENCES_FILENAME = '.dsh-zcode-preferences.json'

/** 偏好文件路径。 */
export function zcodePreferencesPath(dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), ZCODE_PREFERENCES_FILENAME))
}

/** 文件落盘的偏好存储。 */
export class ZCodePreferencesStore {
  readonly filename: string

  constructor(filename: string = zcodePreferencesPath()) {
    this.filename = resolve(filename)
  }

  /** 读取偏好；文件缺失或内容不可解析时返回默认值。 */
  async read(): Promise<ZCodePreferences> {
    let text: string
    try {
      text = await readFile(this.filename, 'utf8')
    } catch {
      return DEFAULT_ZCODE_PREFERENCES
    }
    try {
      return normalizePreferences(JSON.parse(text))
    } catch {
      return DEFAULT_ZCODE_PREFERENCES
    }
  }

  /** 合并写入偏好；返回落盘后的完整值。 */
  async write(patch: unknown): Promise<ZCodePreferences> {
    const current = await this.read()
    const next = normalizePreferences({
      ...current,
      ...(patch !== null && typeof patch === 'object' && !Array.isArray(patch)
        ? patch as Record<string, unknown>
        : {}),
    })
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
    return next
  }
}
