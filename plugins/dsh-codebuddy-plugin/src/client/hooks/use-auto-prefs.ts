/**
 * 三个 auto* 偏好的统一管理 hook。
 *
 * 拆出来的原因：账号管理区块用这一组偏好的持久化 + Host 同步，集中写一处，
 * 否则每个使用点都得抄一份「RPC + store 双向同步」。集中后的契约：
 *
 *  - store（`$autoCheckin` / `$autoSwitch` / `$autoTravel`）是展示态来源；
 *  - 挂载时**采纳** Host 的值（已持久化的部分），不把本地推过去；
 *  - Host 尚无配置（老用户首次升级）时，把本地值**一次性**迁移上去；
 *  - 后续 store 变化（任何标签页/任何视图）都同步给 Host。
 *
 * 迁移期处理原先在设置页（`CodeBuddySection`）。设置区块随配置入口迁移被移除
 * 后，那段逻辑**必须**搬到这里：它是老用户偏好上行的唯一通道，跟着界面一起
 * 消失会让既有 localStorage 值永远推不到 Host（表现为"升级后自动切换开关
 * 明明开着，宿主侧却是默认值"）。
 *
 * @module dsh-codebuddy/hooks/use-auto-prefs
 */

import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { CODEBUDDY_AUTH_CHANNEL } from '../../contracts/constants.ts'
import type { ConnectionRpc } from '../rpc.ts'
import {
  $autoCheckin,
  $autoSwitch,
  $autoSwitchThreshold,
  $autoTravel,
  adoptHostPrefs,
  isAdoptingPrefs,
  subscribeUsagePref,
} from '../store/usage-prefs.ts'

/** `autoPrefs` 端点的应答：Host 侧的四个偏好 + 是否确实落过盘。 */
interface HostAutoPrefs {
  autoSwitch: boolean
  autoSwitchThresholdPct: number
  autoCheckin: boolean
  autoTravel: boolean
  /**
   * Host 磁盘上是否已有配置。
   *
   * 区分「Host 有权威值」与「Host 只有默认值」：前者一律以 Host 为准，后者
   * 才允许把本地既有值迁移上去。少了这个判据就会用旧 localStorage 覆盖
   * Host 上更新的值（实测发生过：Host 为 false/25 被上推成 true/10）。
   */
  hasStoredPrefs: boolean
}

/**
 * 把「三个偏好」绑到当前组件生命周期上：
 *  - 展示值用 `useStore`（底层即 useSyncExternalStore，订阅 store 变化）；
 *  - 挂载时 fetch Host 已持久化的偏好并写回 store；
 *  - 卸载/重 mount 时清理订阅。
 *
 * Host 采纳失败的兜底：失败时不写 store（store 现有值保留），让 UI 显示的
 * 是之前任一通道写入的值——总比回退成默认更稳定。
 *
 * @returns 三个偏好当前值（实时）+ 三个 setter。
 */
export function useAutoPrefs(rpc: ConnectionRpc): {
  autoCheckin: boolean
  autoSwitch: boolean
  autoTravel: boolean
} {
  const autoCheckinOn = useStore($autoCheckin)
  const autoSwitchOn = useStore($autoSwitch)
  const autoTravelOn = useStore($autoTravel)

  useEffect(() => {
    // 挂载时**从 Host 采纳**配置，而不是把本地的推上去。
    //
    // 曾经这里把三个开关的持久化值推给主机，会让 Host 上更新的值被旧 localStorage
    // 静默覆盖（与设置页同一问题）。现在方向统一为「Host 为准」；store 的 set 带
    // 相等性检查，值相同时不通知，因此不会触发回写循环。
    void rpc.call<HostAutoPrefs>(CODEBUDDY_AUTH_CHANNEL, 'autoPrefs', {}).then((result) => {
      if (!result.ok) return
      const host = result.value
      if (host.hasStoredPrefs) {
        /**
         * Host 是权威：整组原子采纳它的值（可能来自另一个窗口的修改）。
         *
         * 用 `adoptHostPrefs` 而不是逐个 `set`：后者曾**漏掉阈值**，于是同一份
         * Host 配置在不同视图得到不同的本地副本（阈值是共享的持久化 atom）。
         * 它还负责整组抑制回推——这些是共享的持久化 atom，逐个裸 `set` 会同步
         * 触发下面的回推订阅，而回推读的是「当前全部偏好」，第一个 `set` 触发
         * 时其余尚未采纳，会把本地旧值推给 Host，把「Host 为准」反转成「本地
         * 为准」。
         */
        adoptHostPrefs(host)
        return
      }
      // 老用户升级路径：Host 尚无配置，把本地既有值迁移上去，只此一次。
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoSwitch', {
        enabled: $autoSwitch.get(),
        thresholdPct: $autoSwitchThreshold.get(),
      })
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoCheckin', { enabled: $autoCheckin.get() })
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoTravel', { enabled: $autoTravel.get() })
    })
    /**
     * 偏好变化后把新值同步给 host。展示值本身由 store 驱动（见上面的 useStore），
     * 这里只负责 host 侧：一个视图改动的开关必须让 host 也知道。
     *
     * 采纳期间**不回推**：那些变化源自 Host 自己，绕一圈推回去没有新信息，还会
     * 覆盖别的窗口在此期间做的修改（见 `whileAdoptingPrefs` 的说明）。
     *
     * 这里**故意不带** `thresholdPct`：阈值的写入方是详情页的滑杆（它已显式带上
     * 该字段），而 host 在字段缺省时会保留现值。若在这里也带上，等于让一个只关心
     * 布尔开关的回调去改写阈值——一旦将来有哪条路径让本地副本先于采纳变陈旧，
     * 就会把旧阈值推给 Host，正是这类不一致最难排查的形态。
     */
    return subscribeUsagePref(() => {
      if (isAdoptingPrefs()) return
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoCheckin', { enabled: $autoCheckin.get() })
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoTravel', { enabled: $autoTravel.get() })
      void rpc.call(CODEBUDDY_AUTH_CHANNEL, 'autoSwitch', { enabled: $autoSwitch.get() })
    })
  }, [rpc])

  return { autoCheckin: autoCheckinOn, autoSwitch: autoSwitchOn, autoTravel: autoTravelOn }
}
