/** fnOS replacement for DSH's settings.openDocument header action. */

import { useCallback, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DshButton, DshIconSetting as IconSetting } from '@tnnevol/dsh-semi-ui'
import { hasFnosHostBridge, readSdkCapabilityFlags } from '../client/services/host-bridge.ts'
import { createTrimApp } from '../client/services/sdk.ts'
import { requestSettingsDocumentPath } from '../client/services/settings-document-client.ts'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

type SettingsDocumentActionProps = PropsRuntime<'settings.action'> & PropsLocale<'settings.dsh-fnos'> & {
  t: Translate
}

export function FnosSettingsDocumentAction({ t }: SettingsDocumentActionProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const open = useCallback(async () => {
    if (!hasFnosHostBridge(readSdkCapabilityFlags())) return
    setBusy(true)
    setError(false)
    try {
      const path = await requestSettingsDocumentPath()
      const sdk = createTrimApp()
      await sdk.ready()
      if (!sdk.isWeb || sdk.isStandaloneWeb) throw new Error('fnOS iframe SDK did not initialize its web carrier')
      await sdk.openFile(path)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }, [])

  // 该动作靠 SDK 的 `openFile` 打开 NAS 上的配置文件，独立浏览器页面没有宿主桥。
  if (!hasFnosHostBridge(readSdkCapabilityFlags())) return null
  return (
    <DshButton
      size="small"
      type="secondary"
      theme="outline"
      className="dsh-fnos-settings-document-button"
      disabled={busy}
      title={error ? t('settingsDocumentOpenFailed') : t('openSettingsDocument')}
      onClick={() => { void open() }}
    >
      <span className="dsh-fnos-settings-document-icon">
        <IconSetting />
      </span>
      {error ? t('settingsDocumentOpenFailed') : t('openSettingsDocument')}
    </DshButton>
  )
}
