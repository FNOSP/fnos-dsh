# @tnnevol/dsh-midscene

在本地托管一个 OpenAI 兼容的桥接服务，把 [Midscene](https://midscenejs.com) 浏览器自动化的模型请求接到 **DSH 宿主模型层**——凡是 DSH 里已配置的模型（DeepSeek 官方路由、CodeBuddy、Codex、自定义 OpenAI/Anthropic 兼容端点），Midscene 都能用。

凭据、请求协议与 token 续期由各提供方插件在宿主内处理，桥不读取、不存储、不转发任何凭据。

## 安装

```sh
dsh plugin --profile web add @tnnevol/dsh-midscene@0.2.1-rc.2.0
```

安装后重启 DSH Web profile。

## 接入

在运行 Midscene 命令的工作目录写 `.env`：

```sh
MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"
MIDSCENE_MODEL_API_KEY="local-bridge"
MIDSCENE_MODEL_NAME="codebuddy/glm-5.3-flash"
MIDSCENE_MODEL_FAMILY="glm-v"
```

模型名从 `curl -s http://127.0.0.1:8787/v1/models` 里选；建议选 `vision: true` 的模型（Midscene 靠截图理解页面）。

## 端点

| 端点 | 用途 |
| --- | --- |
| `GET /v1/models` | 模型目录（标识为「提供方/模型」） |
| `POST /v1/chat/completions` | 对话补全（流式与非流式，支持图片输入） |
| `GET /v1/health` | 健康检查 |

安装插件后 Midscene 的浏览器自动化技能随插件内置分发，会话中可直接使用，无需 `npx skills add`。

完整说明（配置模板、故障排查、额度提示、配置项）见[插件文档](https://fnapps-doc.tnnevol.cn/plugins/dsh-midscene)。
