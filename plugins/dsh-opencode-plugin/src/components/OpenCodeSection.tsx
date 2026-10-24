/** 插件详情页的 OpenCode 区块：账号、套餐额度、模型目录与设置四张卡片。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { OpenCodeTranslate } from '../client/locales.ts'
import { authEpoch, subscribeAuthEpoch } from '../client/services/auth-events.ts'
import { errorMessage } from '../client/services/http.ts'
import type { TimerService } from '../client/services/polling.ts'
import type { OpenCodePreferencesStore } from '../client/services/preferences-data.ts'
import { isOpenCodeBundleSubject } from '../client/services/registration.ts'
import type { OpenCodePluginSubject } from '../client/services/registration.ts'
import { OpenCodeAccountCard } from './OpenCodeAccountCard.tsx'
import { OpenCodeCatalogCard } from './OpenCodeCatalogCard.tsx'
import { OpenCodeSettingsCard } from './OpenCodeSettingsCard.tsx'
import { OpenCodeUsageCard } from './OpenCodeUsageCard.tsx'

/** 注册方闭包注入的依赖。 */
export interface OpenCodeSectionInjected {
  readonly t: OpenCodeTranslate
  readonly preferences: OpenCodePreferencesStore
  readonly timer: TimerService
}

/** 详情页区块的完整道具：注入面 + 座位 owner props。 */
export type OpenCodeSectionProps = OpenCodeSectionInjected & {
  readonly subject?: OpenCodePluginSubject | undefined
}

/**
 * 详情页区块的座位入口：先按 subject 过滤，再渲染真正的内容。
 *
 * `plugins.detail.section` 是 list 座位，页面会给打开的每个详情页都渲染它；
 * 不筛选就会把这段界面显示到别的插件详情页上。
 *
 * @returns 本插件的组合包详情页上渲染内容，否则 `null`。
 */
export function OpenCodeSection({ t, preferences, timer, subject }: OpenCodeSectionProps): ReactNode {
  if (!isOpenCodeBundleSubject(subject)) return null
  return <OpenCodeSectionContent t={t} preferences={preferences} timer={timer} />
}

/** 四张卡片的编排：共享偏好快照与登录代际。 */
function OpenCodeSectionContent({ t, preferences, timer }: OpenCodeSectionInjected): ReactNode {
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
      if (live) setPreferencesError(errorMessage(error, t('settingsLoadFailed')))
    })
    return () => { live = false }
  }, [preferences, t])

  return (
    <div className="dsh-opencode-section">
      <header className="dsh-opencode-section-head">
        <h2 className="dsh-opencode-section-title">{t('title')}</h2>
        <p className="dsh-opencode-section-desc">{t('intro')}</p>
      </header>
      <OpenCodeAccountCard t={t} timer={timer} />
      <OpenCodeUsageCard
        t={t}
        timer={timer}
        refreshMinutes={preferenceValues.refreshMinutes}
        revision={revision}
      />
      <OpenCodeCatalogCard
        t={t}
        timer={timer}
        preferences={preferences}
        hiddenModels={preferenceValues.hiddenModels}
        preferencesLoaded={loaded}
        refreshMinutes={preferenceValues.refreshMinutes}
        revision={revision}
      />
      <OpenCodeSettingsCard
        t={t}
        preferences={preferences}
        loaded={loaded}
        loadError={preferencesError}
        usageVisibility={preferenceValues.usageVisibility}
        refreshMinutes={preferenceValues.refreshMinutes}
        endpointPlan={preferenceValues.endpointPlan}
      />
    </div>
  )
}
