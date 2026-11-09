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
import { DshModal } from '@tnnevol/dsh-semi-ui'
import { IconifyIcon } from './IconifyIcon.tsx'
import type { FnosLocaleKey } from '../client/locales.ts'
import { AuthorizedDirectoriesCard } from './AuthorizedDirectoriesCard.tsx'
import { DependencyRepairCard } from './DependencyRepairCard.tsx'

type Translate = (key: FnosLocaleKey) => string

/** 弹框里的一级分组；新增配置项时在这里登记。 */
type SectionId = 'directories' | 'repair'

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
    { id: 'repair', label: t('configSectionRepair'), icon: 'lucide:wrench' },
  ]

  return (
    <DshModal
      visible={visible}
      title={t('configDialogTitle')}
      onCancel={onClose}
      footer={null}
      width={880}
      /*
        必须用 `contentClassName` 而不是 `className`：
        - `className` 落到最外层的 `.semi-modal-wrap`（Semi 把它拼在 wrap 上），
          于是所有 `.dsh-fnos-config-dialog .semi-modal-content` 规则全部落空；
        - `contentClassName` 才是拼到 `.semi-modal-content` 上的那个 prop。
        实测两者混用还会让 content 的 class 里出现字面量 `undefined`。
      */
      contentClassName="dsh-fnos-config-dialog"
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
          {section === 'directories' ? <AuthorizedDirectoriesCard t={t} /> : null}
          {section === 'repair' ? <DependencyRepairCard t={t} /> : null}
        </div>
      </div>
    </DshModal>
  )
}
