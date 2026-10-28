/**
 * 授权目录树的数据搬运。
 *
 * 这里只放纯函数：`AuthorizedEntry` 怎么落成 Semi Tree 的节点、懒加载到的
 * 子节点怎么并回树、`value` 怎么归一成路径数组。把这几件与 React 无关的事
 * 抽出来，浮层组件只负责渲染与引用对账，测试也可以直接断言数据转换。
 */

import type { ReactNode } from 'react'
import type { AuthorizedEntry } from '../../contracts/authorized-directories-contract.ts'

/** Semi Tree 的节点形状（只列本插件用到的字段）。 */
export interface PickerTreeNode {
  key: string
  value: string
  label: ReactNode
  isLeaf: boolean
  children?: PickerTreeNode[]
}

/** 取路径最后一段作为显示名；根路径原样返回。 */
export function displayName(value: string): string {
  const parts = value.split('/').filter(Boolean)
  return parts.at(-1) ?? value
}

/** 把一个授权条目转成树节点；`label` 由调用方给出（它需要 JSX 与本地化）。 */
export function toTreeNode(entry: AuthorizedEntry, label: ReactNode): PickerTreeNode {
  return {
    key: entry.path,
    value: entry.path,
    label,
    isLeaf: entry.kind === 'file',
  }
}

/**
 * 把懒加载到的子节点并回树。
 *
 * 命中节点会把 `isLeaf` 置为 false：Semi 的懒加载只在节点此前被判定为可展开
 * 时才触发 `loadData`，一次性把空目录的 `isLeaf` 留成 true 会让它再也打不开。
 */
export function updateChildren(
  nodes: readonly PickerTreeNode[],
  key: string,
  children: PickerTreeNode[],
): PickerTreeNode[] {
  return nodes.map(node => {
    if (node.key === key) return { ...node, children, isLeaf: false }
    if (node.children === undefined) return node
    return { ...node, children: updateChildren(node.children, key, children) }
  })
}

/**
 * 归一化 Semi Tree 的 `value`。
 *
 * 保留每一个已勾选路径，不做父子折叠：`checkRelation="unRelated"` 下父子可以
 * 同时勾选，折叠会把用户显式选中的父目录悄悄丢掉。
 */
export function selectedPaths(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return [...new Set(values.flatMap(item => typeof item === 'string' && item.startsWith('/') ? [item] : []))]
}
