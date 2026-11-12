import type { NextHandleFunction } from 'connect'

/**
 * fnOS 授权回调页。
 *
 * ## 为什么需要它
 *
 * 独立浏览器页面没有宿主桥，文件选择与授权必须走 `openAppAuth`：SDK 在
 * **系统授权页弹窗**里让用户确认目录，完成后由系统把结果 redirect 到调用时
 * 传入的 `redirectUri`。这个 `redirectUri` 必须是应用自己提供的一个真实页面
 * ——它负责解析结果、通知打开它的原页面，然后自行关闭。没有这一页，授权流程
 * 在最后一步断掉：用户确认了，原页面永远等不到结果。
 *
 * ## 为什么由网关提供，而不是放进 DSH 的静态目录
 *
 * DSH 的静态资源在应用进程里，而回调页要在授权页跳转后**独立加载**；它不需要
 * 也不应该拉起整个 DSH 应用。网关本身就是应用对外的入口，在这里用一个内联
 * 响应返回这一页，既不用往应用资源目录塞文件，也不受 DSH 前端构建影响。
 *
 * ## 同源要求
 *
 * 页面里的 `postMessage` 只在同源下可靠：文档明确建议把 `redirectUri` 放在
 * `/app/<应用>/` 下（本网关正是这个前缀的提供者）。这里再校验一次
 * `event.origin`，避免把结果交给别处的窗口。
 */

/** 回调页在网关下的路径（相对 `/app/<应用>/`）。 */
export const APP_AUTH_CALLBACK_PATH = '/fnos-auth-callback'

/** 回调页发给原页面的消息类型，与客户端 `app-auth.ts` 保持一字不差。 */
export const APP_AUTH_MESSAGE_TYPE = 'dsh-fnos:auth-result'

/**
 * 回调页 HTML。
 *
 * 纯静态、无外部依赖：这一页要在授权跳转后立刻可用，任何额外请求都可能失败。
 * 解析逻辑用 URLSearchParams 而不是引入 SDK——SDK 在独立浏览器里初始化会尝试
 * 连接宿主桥，对一页「只读查询串」的页面是纯负担。
 */
const CALLBACK_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fnOS 授权结果</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: Canvas;
    color: CanvasText;
    font: 14px/1.7 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  main { max-width: 420px; padding: 32px 24px; text-align: center; }
  h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
  p { margin: 0; color: color-mix(in srgb, CanvasText 70%, transparent); }
</style>
</head>
<body>
<main>
  <h1 id="title">授权完成</h1>
  <p id="detail">正在返回原页面…</p>
</main>
<script>
(() => {
  var MSG = ${JSON.stringify(APP_AUTH_MESSAGE_TYPE)};
  var params = new URLSearchParams(location.search);
  var paths = [];
  var raw = params.get('path');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) paths = parsed.filter(function (item) { return typeof item === 'string'; });
    } catch (error) { paths = []; }
  }
  var result = {
    status: params.get('status') || undefined,
    error: params.get('error') || undefined,
    method: params.get('method') || undefined,
    appName: params.get('appName') || undefined,
    state: params.get('state') || undefined,
    path: paths.length > 0 ? paths : undefined
  };

  var title = document.getElementById('title');
  var detail = document.getElementById('detail');
  if (result.status === 'error') {
    title.textContent = '授权失败';
    detail.textContent = result.error === 'access_denied' ? '已取消或未获得授权。' : '授权未完成，请回到原页面重试。';
  } else if (result.status === 'cancel') {
    title.textContent = '已取消授权';
    detail.textContent = '这次没有授权任何目录。';
  } else {
    title.textContent = '授权完成';
    detail.textContent = paths.length > 0 ? '已授权 ' + paths.length + ' 个目录。' : '授权结果已返回。';
  }

  // 只在同源时通知：跨源的 opener 不该拿到本次授权结果。
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: MSG, result: result }, location.origin);
  }

  // 给原页面一点时间接收消息再关闭；关闭被拦截时保留文案让用户手动返回。
  window.setTimeout(function () { try { window.close(); } catch (error) { /* 关闭被拦截，留在本页 */ } }, 600);
})();
</script>
</body>
</html>
`

/**
 * 授权回调页中间件。
 *
 * 只响应自己的路径，其余请求交给后续中间件——它是网关链上的一小段，不是兜底。
 * @returns connect 中间件。
 */
export function appAuthCallback(): NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?', 1)[0]
    if (path !== APP_AUTH_CALLBACK_PATH) {
      next()
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    // 结果来自查询串，且页面每次都要重新执行脚本，禁止任何缓存。
    res.setHeader('cache-control', 'no-store')
    res.end(CALLBACK_HTML)
  }
}
