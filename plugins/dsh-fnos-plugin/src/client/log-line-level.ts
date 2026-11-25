/**
 * 按行内容推断 pnpm 输出的日志级别。
 *
 * npm / pnpm 输出是纯文本，没有级别字段；这里只做最小判断——含「失败 / 错误 /
 * error」的算错误，含「警告 / warn」的算警告，其余按信息。宁可少标也不要误标：
 * 级别配色只是帮助扫读，判错反而误导。
 *
 * 三个消费者（安装浮层、镜像源卡片、卸载）都用同一份判断。早前各自抄了一份，
 * 改一处就会漂到另一处。
 *
 * @param line - 日志行。
 * @returns 级别。
 */
export function levelOfInstallLine(line: string): 'info' | 'warn' | 'error' {
  if (/失败|错误|error|failed/i.test(line)) return 'error'
  if (/警告|warn/i.test(line)) return 'warn'
  return 'info'
}
