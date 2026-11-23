/**
 * 「npm 镜像管理」的客户端。
 * @module dsh-fnos/client/npm-mirror-client
 */

import {
  FNOS_NPM_MIRROR_USE_ROUTE,
  FNOS_NPM_MIRROR_STATUS_ROUTE,
  FNOS_NPM_MIRROR_INSTALL_ROUTE,
  FNOS_NPM_MIRROR_UNINSTALL_ROUTE,
} from '../../contracts/gateway-proxy-contract.ts'

/** 一个镜像源。 */
export interface NpmMirror {
  readonly name: string
  readonly registry: string
  readonly current: boolean
}

/** 镜像状态。 */
export interface NpmMirrorStatus {
  readonly available: boolean
  readonly reason?: string
  readonly version?: string
  readonly mirrors: readonly NpmMirror[]
  readonly error?: string
}

/**
 * 取镜像状态。
 * @returns 状态。
 */
export async function fetchNpmMirrorStatus(): Promise<NpmMirrorStatus> {
  const response = await fetch(FNOS_NPM_MIRROR_STATUS_ROUTE, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const value = await response.json() as Partial<NpmMirrorStatus>
  return {
    available: value.available === true,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    mirrors: Array.isArray(value.mirrors)
      ? value.mirrors.filter((item): item is NpmMirror => typeof item === 'object' && item !== null && typeof (item as NpmMirror).name === 'string')
      : [],
  }
}

/**
 * 切换镜像源。
 * @param name - 镜像名。
 */
export async function switchNpmMirror(name: string): Promise<void> {
  const response = await fetch(FNOS_NPM_MIRROR_USE_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
}

/**
 * 安装 nrm。
 */
export async function installNrm(): Promise<void> {
  const response = await fetch(FNOS_NPM_MIRROR_INSTALL_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  })
  if (!response.ok) {
    const value = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof value?.message === 'string' ? value.message : `HTTP ${String(response.status)}`)
  }
}


/**
 * 卸载 nrm。
 *
 * 失败时抛出错误信息——调用方（卡片）把它显示在就地提示里，与安装失败同一处理。
 */
export async function uninstallNrm(): Promise<void> {
  const response = await fetch(FNOS_NPM_MIRROR_UNINSTALL_ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof payload?.message === 'string' ? payload.message : `卸载失败（HTTP ${String(response.status)}）`)
  }
}
