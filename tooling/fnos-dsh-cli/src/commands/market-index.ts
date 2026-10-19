import { program } from '../program.js'
import { regenerateMarketIndex } from '../core/market-index.js'

/**
 * 手动同步插件市场索引。
 *
 * 发布流程已经会在收尾自动执行同一步，这条命令用于两种场景：
 * - 发布时生成器不可用（未配置 `DSH_DESKTOP_APP_DIR`、离线），事后补跑；
 * - 只改了已发布版本的元数据并重新发版，需要单独刷新索引。
 *
 * 刻意做成独立入口而不是塞进 `version`：索引跟随的是 **npm 上已发布版本**，
 * 本地改版本号时 npm 还没变，此时生成只会得到与原来相同的内容。
 */
program
  .command('market:index')
  .description('Regenerate the plugin market index from published npm versions')
  .action(async () => {
    await regenerateMarketIndex()
  })
