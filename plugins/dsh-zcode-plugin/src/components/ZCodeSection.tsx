/**
 * 插件详情页的 ZCode 区块：账号、额度、模型目录与设置四张卡片。
 *
 * @module dsh-zcode/components/ZCodeSection
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ZCodeTranslate } from '../client/locales.ts'
import { authEpoch, subscribeAuthEpoch } from '../client/services/auth-events.ts'
import { errorMessage } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { ZCodePreferencesStore } from '../client/services/preferences-data.ts'
import { isZCodeBundleSubject } from '../client/services/registration.ts'
import type { ZCodePluginSubject } from '../client/services/registration.ts'
import { ZCodeAccountCard } from './ZCodeAccountCard.tsx'
import { ZCodeCatalogCard } from './ZCodeCatalogCard.tsx'
import { ZCodeSettingsCard } from './ZCodeSettingsCard.tsx'
import { ZCodeUsageCard } from './ZCodeUsageCard.tsx'

/** 注册方闭包注入的依赖。 */
export interface ZCodeSectionInjected {
  readonly t: ZCodeTranslate
  readonly preferences: ZCodePreferencesStore
  readonly timer: TimerService
}

/** 详情页区块的完整道具：注入面 + 座位 owner props。 */
export type ZCodeSectionProps = ZCodeSectionInjected & {
  readonly subject?: ZCodePluginSubject | undefined
}

/**
 * 详情页区块的座位入口：先按 subject 过滤，再渲染真正的内容。
 *
 * `plugins.detail.section` 是 list 座位，页面会给打开的每个详情页都渲染它；
 * 不筛选就会把这段界面显示到别的插件详情页上。
 */
export function ZCodeSection({ t, preferences, timer, subject }: ZCodeSectionProps): ReactNode {
  if (!isZCodeBundleSubject(subject)) return null
  return <ZCodeSectionContent t={t} preferences={preferences} timer={timer} />
}

/** 四张卡片的编排：共享偏好快照与登录代际。 */
function ZCodeSectionContent({ t, preferences, timer }: ZCodeSectionInjected): ReactNode {
  const { value: preferenceValues, loaded } = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  )
  const revision = useSyncExternalStore(subscribeAuthEpoch, authEpoch, authEpoch)
  const [preferencesError, setPreferencesError] = useState<string>()

  useEffect(() => {
    let live = true
    void preferences.ensureLoaded().catch((error: unknown) => {
      if (live) setPreferencesError(errorMessage(error, t('settingsFailed')))
    })
    return () => { live = false }
  }, [preferences, t])

  return (
    <div className="dsh-zcode-section">
      <header className="dsh-zcode-section-head">
        <h2 className="dsh-zcode-section-title">{t('sectionTitle')}</h2>
        <p className="dsh-zcode-section-desc">{t('sectionDesc')}</p>
      </header>
      <ZCodeAccountCard t={t} timer={timer} />
      <ZCodeUsageCard
        t={t}
        timer={timer}
        refreshMinutes={preferenceValues.refreshMinutes}
        revision={revision}
      />
      <ZCodeCatalogCard
        t={t}
        timer={timer}
        preferences={preferences}
        hiddenModels={preferenceValues.hiddenModels}
        preferencesLoaded={loaded}
        refreshMinutes={preferenceValues.refreshMinutes}
        revision={revision}
      />
      <ZCodeSettingsCard
        t={t}
        preferences={preferences}
        loaded={loaded}
        loadError={preferencesError}
        usageVisibility={preferenceValues.usageVisibility}
        refreshMinutes={preferenceValues.refreshMinutes}
      />
    </div>
  )
}
