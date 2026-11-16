/**
 * fnOS 配置弹框：左侧菜单 + 右侧主体。
 *
 * ## 为什么自建而不是复用官方设置弹框
 *
 * 官方那个「左菜单 + 右主体」的容器占用 `settings.shell` 槽位，且是 **single**
 * ——它自己就是那个弹框，插件没有位置往它的菜单里加一条「飞牛 OS」。因此这里按
 * 同样的视觉形态自建一个：左侧是配置分组，右侧渲染该组的内容。
 *
 * ## 为什么配置从详情页搬过来
 *
 * 详情页里的两段配置（授权目录、依赖修复）随详情页滚动，找一条路径要翻很长；
 * 用户也习惯「配置在设置里」。搬到弹框后详情页不再保留这两块——同一份配置只
 * 出现在一个地方，避免两处都能改、状态却不一致。
 *
 * @module dsh-fnos/components/FnosConfigDialog
 */

import { useState } from 'react'
import type { UsedIconName } from './IconifyIcon.tsx'
import { HAS_FNOS_HOST_BRIDGE } from '../client/services/runtime-env.ts'
import { DshEmpty } from '@tnnevol/dsh-semi-ui'
import { FnosEmptyIllustration } from './FnosEmptyIllustration.tsx'
import { DshModal } from '@tnnevol/dsh-semi-ui'
import { IconifyIcon } from './IconifyIcon.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'
import { AuthorizedDirectoriesCard } from './AuthorizedDirectoriesCard.tsx'
import { GatewayProxyCard } from './GatewayProxyCard.tsx'
import { RuntimeStatusCard } from './RuntimeStatusCard.tsx'
import { RuntimeLogPanel } from './RuntimeLogPanel.tsx'

type Translate = (key: FnosLocaleKey) => string

/** 弹框里的一级分组；新增配置项时在这里登记。 */
type SectionId = 'directories' | 'plugins' | 'runtime' | 'logs'

export interface FnosConfigDialogProps {
  /** 是否可见。 */
  readonly visible: boolean
  /** 关闭回调。 */
  readonly onClose: () => void
  /** 翻译函数。 */
  readonly t: Translate
}

/**
 * fnOS 配置弹框。
 * @param props - 组合后的 props。
 * @param props.visible - 是否可见。
 * @param props.onClose - 关闭回调。
 * @param props.t - 翻译函数。
 * @returns 配置弹框。
 */
export function FnosConfigDialog({ visible, onClose, t }: FnosConfigDialogProps): React.ReactNode {
  const [section, setSection] = useState<SectionId>('directories')

  // 每项配一个图标：纯文字分组在窄列里不易扫读，图标给一眼可辨的锚点。
  const sections: readonly { id: SectionId, label: string, icon: UsedIconName }[] = [
    { id: 'directories', label: t('configSectionDirectories'), icon: 'lucide:folder' },
    /*
      「插件管理」紧跟授权目录：两者都是「哪些东西能进来」的配置。
      它内部再用 tab 分成「插件反代 / 插件安装异常 / 已安装的插件」三块——
      原先「插件安装修复」是并列的一级菜单项，但它只服务于插件安装这一件事，
      与反代、已装列表同属「插件」，摊平在一级菜单里会让左列显得比实际更碎。
    */
    { id: 'plugins', label: t('configSectionPlugins'), icon: 'lucide:blocks' },
    // 「运行」放最后：它是只读观测，不属于「设置」，放在配置项之后符合阅读顺序。
    { id: 'runtime', label: t('configSectionRuntime'), icon: 'lucide:activity' },
    // 日志排在运行之后：先看「现在怎么样」，再看「发生过什么」。
    { id: 'logs', label: t('configSectionLogs'), icon: 'lucide:scroll-text' },
  ]

  return (
    <DshModal
      visible={visible}
      title={t('configDialogTitle')}
      onCancel={onClose}
      footer={null}
      width={800}
      /*
        Semi Modal 有三个容易搞混的 class prop，只有第三个能用：
        - `className` → 拼到最外层 `.semi-modal-wrap`；
        - `contentClassName` → **被 Modal 内部覆盖**成 `${animationClassName} ${modalContentClass}`，
          调用方传的值直接丢弃（实测 content 的 class 变成
          `"semi-modal-content  undefined"`，两个空格正是动画类为空）；
        - `modalContentClass` → 唯一会被拼进 `.semi-modal-content` 的入口。
      */
      modalContentClass="dsh-fnos-config-dialog"
    >
      <div className="dsh-fnos-config-body">
        {/*
          左侧菜单用原生 button + aria-current，而不是 Semi 的 Menu：这里是「切换
          页面」而不是「选择一个值」，原生 button 的语义与键盘行为已经够用，也避免
          再引入一套菜单状态。
        */}
        <nav className="dsh-fnos-config-nav" aria-label={t('configDialogTitle')}>
          {sections.map(item => (
            <button
              key={item.id}
              type="button"
              className={`dsh-fnos-config-nav-item${item.id === section ? ' dsh-fnos-config-nav-item--active' : ''}`}
              aria-current={item.id === section ? 'page' : undefined}
              onClick={() => { setSection(item.id) }}
            >
              <IconifyIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="dsh-fnos-config-panel">
          {/*
            **只有「授权目录」依赖 fnOS 宿主，其余分组在本地 DSH Web 里照常可用。**

            四个分组的实际依赖不同：

            | 分组 | 数据来源 | 本地可用 |
            | --- | --- | --- |
            | 授权目录 | fnOS 宿主桥（选目录、ACL） | 否 |
            | 插件管理 | 插件自己的网关代理路由 | 是 |
            | 运行 | 插件自己的 runtime-status 路由 | 是 |
            | 日志 | 插件自己的 runtime-logs 路由 | 是 |

            所以不能按环境整体屏蔽——那样会把三个本来能用的面板一起换成缺省页。
            只在需要 fnOS 的那个分组里给缺省页，并说明原因。
          */}
          {section === 'directories' && !HAS_FNOS_HOST_BRIDGE ? (
            <DshEmpty
              className="dsh-fnos-config-empty"
              image={<FnosEmptyIllustration size={140} />}
              title={t('configEmptyTitle')}
              description={t('configEmptyDescription')}
            />
          ) : null}
          {section === 'directories' && HAS_FNOS_HOST_BRIDGE ? <AuthorizedDirectoriesCard t={t} /> : null}
          {section === 'plugins' ? <GatewayProxyCard t={t} /> : null}
          {section === 'runtime' ? <RuntimeStatusCard t={t} /> : null}
          {section === 'logs' ? <RuntimeLogPanel t={t} /> : null}
        </div>
      </div>
    </DshModal>
  )
}
