import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SRC } from './paths.ts'

/**
 * 账号切换的**进行中反馈**。
 *
 * 这是一条真实缺陷的回归守卫：`CodeBuddySection.tsx` 里
 *
 *   const [switchingId, setSwitchingId] = useState<string | undefined>(undefined)
 *   setSwitchingId(id)          // 切换开始
 *   setSwitchingId(undefined)   // 切换结束
 *
 * 两个 setter 都在调用，但 `switchingId` 的值**从未被读取** —— 也就是说：
 *
 *  1. 用户点「设为当前」后没有任何反馈（不知是否生效，容易重复点击）；
 *  2. 每次 setState 都触发一次无用重渲染。
 *
 * 而 locales 里 `accountSwitching: '切换中…'` / `'Switching…'` **已定义却全项目
 * 零引用** —— 两个证据合起来说明：作者本意是切换时显示「切换中…」并禁用按钮，
 * 渲染层漏接了。
 *
 * 重复点击的后果不只是体验：host 侧会连续发起换号，最终停在哪个账号取决于网络
 * 返回顺序。
 *
 * 关于 `loading` 与 `disabled` 的关系（已读 Semi 源码确认，见下测试）：Semi 的
 * Button 在 `loading && !disabled` 时走 IconButton 分支渲染转圈图标，**不会**
 * 自动禁用按钮，因此两个 prop 必须都给。
 */
const ROOT = SRC
// 设置区块（`CodeBuddySection`）随配置入口迁移移除后，账号切换按钮只剩账号卡片
// 菜单里的「设为当前」这一个入口，因此这些不变量改为在卡片与其宿主上验证。
const CARD = readFileSync(`${ROOT}/client/ui/account-card.tsx`, 'utf8')
const DETAIL = readFileSync(`${ROOT}/client/panel.tsx`, 'utf8')
const LOCALES_ZH = readFileSync(`${ROOT}/client/locales/zh.ts`, 'utf8')
const LOCALES_EN = readFileSync(`${ROOT}/client/locales/en.ts`, 'utf8')

/** 卡片菜单里「设为当前」这一项的渲染片段。 */
const switchMenuItemBlock = (): string => {
  const start = CARD.indexOf("key=\"switch\"")
  expect(start).toBeGreaterThan(-1)
  return CARD.slice(start, CARD.indexOf('</DshDropdown.Item>', start))
}

/** 切换动作的执行片段（含在途守卫与收尾）。 */
const switchActionBlock = (): string => {
  const start = DETAIL.indexOf('const switchOne = async')
  expect(start).toBeGreaterThan(-1)
  return DETAIL.slice(start, DETAIL.indexOf('\n  }', start))
}

describe('切换账号按钮有进行中反馈', () => {
  it('在途标记被读取并驱动菜单项的禁用与文案', () => {
    expect(switchActionBlock()).toMatch(/setBusyId\(id\)/)
    const item = switchMenuItemBlock()
    expect(item).toMatch(/disabled=\{[^}]*busy[^}]*\}/)
    expect(item).toMatch(/busy \? labels\.switching : switchLabel/)
  })

  it('切换中禁用入口，避免重复点击导致连续换号', () => {
    // 重复点击会让 host 连续换号，最终停在哪个账号取决于网络返回顺序。
    // 两层守卫：宿主在途时直接返回，卡片菜单项同时禁用。
    expect(switchActionBlock()).toMatch(/if \(busyId !== undefined\) return/)
    expect(switchMenuItemBlock()).toMatch(/disabled=\{[^}]*busy[^}]*\}/)
  })

  it('切换中文案使用既有的 accountSwitching 键（不再是孤立 i18n）', () => {
    // 该键必须真实存在于两种语言，且真的被接线到卡片标签上。
    expect(LOCALES_ZH).toMatch(/accountSwitching: '切换中…'/)
    expect(LOCALES_EN).toMatch(/accountSwitching: 'Switching…'/)
    expect(DETAIL).toMatch(/switching: t\('accountSwitching'\)/)
    expect(switchMenuItemBlock()).toMatch(/labels\.switching/)
  })

  it('在途标记在 finally 里清除，RPC 抛错也不会永久卡住入口', () => {
    const action = switchActionBlock()
    expect(action).toContain('finally')
    expect(action).toMatch(/setBusyId\(undefined\)/)
  })

  it('禁用与宿主守卫同时给：Semi 的 disabled 只是外观，真正的防重在宿主', () => {
    // Semi 的 `disabled` 只挡指针事件；键盘与程序触发的点击仍可能到达 onClick。
    // 因此卡片里的 `if (!busy) onSwitch(...)` 与宿主的在途早退必须同时存在。
    const item = switchMenuItemBlock()
    expect(item).toMatch(/disabled=\{[^}]*busy[^}]*\}/)
    expect(item).toMatch(/if \(!busy\) onSwitch\(row\.id\)/)
    expect(switchActionBlock()).toMatch(/if \(busyId !== undefined\) return/)
  })

  it('余额不足或已掉线时禁用菜单项', () => {
    const item = switchMenuItemBlock()
    expect(item).toMatch(/!row\.usable/)
    expect(item).toMatch(/row\.expired/)
  })
})

/**
 * 当前账号不出现「设为当前」入口。
 *
 * 对当前账号点「设为当前」是自己切自己（host 侧也无意义）。这条规则原先在
 * 设置区块的「选择账号」按钮上实现（且曾经漏掉过——按钮无条件渲染、`disabled`
 * 里那个「不等于当前账号」的条件对当前账号恒为 false，于是非切换状态下可点）。
 * 设置区块移除后，卡片菜单的 `!row.active` 是唯一实现点。
 */
describe('当前账号隐藏「设为当前」入口', () => {
  it('菜单项只在非当前账号上渲染', () => {
    expect(CARD).toMatch(/if \(!row\.active && !autoSwitch\) \{/)
    expect(switchMenuItemBlock()).toMatch(/key="switch"/)
  })

  it('切换在途时菜单项仍渲染，保留下「切换中…」反馈', () => {
    // 切换成功前该账号尚未成为当前账号（`reload()` 在响应回来后才刷新行数据），
    // 若此刻就隐藏，用户点了入口它会直接消失，看不出请求是否发出。
    // 卡片的条件里不含 busy，因此这一点天然成立；断言锁住它，避免有人为了
    // 「切换中别显示」而把 busy 加进隐藏条件。
    const condition = CARD.slice(CARD.indexOf('if (!row.active && !autoSwitch)'), CARD.indexOf('key="switch"'))
    expect(condition).not.toContain('busy')
    expect(switchMenuItemBlock()).toMatch(/busy \? labels\.switching : switchLabel/)
  })
})

/**
 * 自动切换开启时，**所有**账号的「选择账号」都隐藏。
 *
 * 那时账号由策略按剩余额度接管，手动指定会被下一次自动切换覆盖，留一个按不动的
 * 按钮只会让人以为设置没生效。管理面板的「设为当前」菜单项本来就是这个语义
 * （`!row.active && !autoSwitch`），设置区块此前只做成「禁用非当前账号」——两处
 * 对同一个开关的反应不一致。
 *
 * 注意隐藏与禁用的区别不只是外观：禁用会留下一个 Tab 可达、但按不动的元素，
 * 而这里要的是「这个操作此刻不存在」。
 */
describe('自动切换开启时隐藏所有账号的选择入口', () => {
  it('隐藏条件包含 autoSwitch', () => {
    expect(CARD).toMatch(/if \(!row\.active && !autoSwitch\) \{/)
  })

  /**
   * 隐藏条件必须**只**由 autoSwitch 与账号是否为当前决定，且不依赖「是哪个账号」。
   *
   * 设置区块那份实现曾出过真实变异：条件写成
   * `autoSwitch && !switching && account.id === accounts.find(item => item.active)?.id`
   * ——退化成「只隐藏当前账号」，正是要修的 bug，而纯词法检查看不见它
   * （字面量里既没有 isActive 也没有 activeId）。
   *
   * 配置入口迁移后隐藏只剩卡片菜单一处，判据是可读的两个字段：
   * `!row.active && !autoSwitch`。这里直接断言这两个字段（而不是用求值夹具），
   * 因为表达式已足够简单，且卡片是纯 props 组件——真正的行为覆盖由 card 渲染
   * 用例负责。
   */
  it('隐藏判定只由 autoSwitch 与 row.active 决定', () => {
    const condition = CARD.slice(CARD.indexOf('if (!row.active && !autoSwitch)'), CARD.indexOf('key="switch"'))
    expect(condition).toContain('!row.active')
    expect(condition).toContain('!autoSwitch')
    // 不得引入与"是哪个账号"有关的额外判据（那会退化成只隐藏当前账号）。
    expect(condition).not.toMatch(/row\.id|nickname|uid/)
  })

  it('autoSwitch 关闭时显示入口（条件取反正确）', () => {
    // 断言取反方向：写成 `row.active && autoSwitch` 会在完全相反的情形下显示，
    // 是这类条件最容易犯的错。
    expect(CARD).toMatch(/if \(!row\.active && !autoSwitch\) \{/)
  })

  it('切换在途不影响隐藏判定：入口保留，只把文案换成「切换中…」', () => {
    // 若把 busy 加进隐藏条件，用户点了入口它会立刻消失，看不出请求是否发出。
    const condition = CARD.slice(CARD.indexOf('if (!row.active && !autoSwitch)'), CARD.indexOf('key="switch"'))
    expect(condition).not.toContain('busy')
    expect(switchMenuItemBlock()).toMatch(/busy \? labels\.switching : switchLabel/)
  })
})
