import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 测试用的仓库路径解析。
 *
 * 这些用例需要直接读源码文本做结构断言（例如「某个函数体里必须出现某个调用」），
 * 因此要定位到本插件和兄弟包的源文件。此前这些路径写成开发机上的绝对路径，
 * 换一台机器或换检出目录就全部读不到文件。
 *
 * 以本文件所在目录（`plugins/dsh-codebuddy-plugin/tests`）为基准向上解析：
 * 测试与源码始终在同一个检出内，因此相对定位在任何机器上都成立。
 */
const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(TESTS_DIR, '..')
const REPO_ROOT = join(PLUGIN_DIR, '..', '..')

/** 本插件的 `src/` 目录绝对路径。 */
export const SRC = join(PLUGIN_DIR, 'src')

/** 本插件的 `tests/` 目录绝对路径。 */
export const TESTS = TESTS_DIR

/** 仓库根目录绝对路径。 */
export const ROOT = REPO_ROOT

/**
 * 把相对插件 `src/` 的路径解析为绝对路径。
 *
 * 名字带 `Path` 后缀：用例里常把读到的源码文本命名为 `src`，
 * 用 `src` 当函数名会被局部变量遮蔽。
 */
export function srcPath(...segments: string[]): string {
  return join(SRC, ...segments)
}

/** 把相对仓库根的路径解析为绝对路径。 */
export function repo(...segments: string[]): string {
  return join(REPO_ROOT, ...segments)
}

/** 仓库根下 pnpm 虚拟 store 的绝对路径，用于按包名定位依赖。 */
export const PNPM_STORE = join(REPO_ROOT, 'node_modules', '.pnpm')
