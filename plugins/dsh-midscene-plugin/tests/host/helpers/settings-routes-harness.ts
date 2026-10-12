/**
 * 设置端点纯函数的测试入口。
 *
 * 端点本身依赖 `ctx.webServer`（DSH 宿主提供），包级测试无法构造；但真正会出错的
 * 是业务规则——家族白名单校验、模型列表归一化、目录读取失败时的退化、首装密钥
 * 自举。这些都在纯函数里，直接覆盖比模拟整个 HTTP 服务更有价值。
 */
export { normalizePatchForTest, statusSnapshotForTest } from '../../../src/host/settings-routes.ts'
