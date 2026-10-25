# @tnnevol/dsh-midscene

在本地托管一个 OpenAI 兼容的桥接服务，把 [Midscene](https://midscenejs.com) 浏览器自动化的模型请求接到 **DSH 宿主模型层**——凡是 DSH 里已配置的模型（DeepSeek 官方路由、CodeBuddy、Codex、自定义 OpenAI/Anthropic 兼容端点），Midscene 都能用。

凭据、请求协议与 token 续期由各提供方插件在宿主内处理，桥不读取、不存储、不转发任何凭据。

## 安装

```sh
dsh plugin --profile web add @tnnevol/dsh-midscene@0.2.1-rc.2.49
```

安装后重启 DSH Web profile。

## 接入

在运行 Midscene 命令的工作目录写 `.env`（四行都是固定值，换模型请改插件设置而非本文件）：

```sh
MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"
MIDSCENE_MODEL_API_KEY="<插件设置页显示的接入密钥>"
MIDSCENE_MODEL_NAME="dsh-model"
MIDSCENE_MODEL_FAMILY="deepseek"
```

`MIDSCENE_MODEL_NAME` 固定为 `dsh-model`——它代表「跟随 DSH 当前会话的模型」，具体用哪个模型由插件设置决定，不必也不应该在这里写死模型名。上面这段可以在插件设置页点「复制接入配置」直接取到，端口与密钥以那里显示的为准。

想直接指定某个模型时，`MIDSCENE_MODEL_NAME` 也可以换成 `提供方/模型`（从 `curl -s http://127.0.0.1:8787/v1/models` 里选，建议选 `vision: true` 的模型——Midscene 靠截图理解页面）。

### 浏览器扩展不需要配置

上面的配置**只给跑脚本的这一侧用**。桥接模式下推理在 Node / CLI 侧完成，Chrome 里的 Midscene 扩展只当「眼睛和手」——截图、点击、输入，**不参与模型调用**，因此扩展的 `Model Env Config` **留空也能正常用**。

唯一需要把这段粘进扩展的地方，是使用**扩展自带的 Playground**（在扩展侧边栏里手写自然语言指令、由扩展自己驱动页面）。用本插件做桥接自动化时不需要这一步。

判据：若漏掉 CLI 侧的配置，报错是

```
Model configuration is incomplete: model name (MIDSCENE_MODEL_NAME) is required
```

——**报错点在 CLI 侧**，说明配置属于这一侧；而扩展能不能连上只取决于它是否已安装、首次连接有没有点过 **Allow**，与填没填模型无关。

## 端点

| 端点 | 用途 |
| --- | --- |
| `GET /v1/models` | 模型目录（标识为「提供方/模型」） |
| `POST /v1/chat/completions` | 对话补全（流式与非流式，支持图片输入） |
| `GET /v1/health` | 健康检查（含各职责当前解析到的模型） |
| `GET /v1/midscene-env` | 直接返回上文那段接入配置，便于脚本拉取 |

只提供 OpenAI Chat Completions 一种协议；请求 `/v1/responses` 或 `/v1/systemone` 会得到明确的 404 与替代指引，而不是难懂的失败。

安装插件后 Midscene 的浏览器自动化技能随插件内置分发，会话中可直接使用，无需 `npx skills add`。

完整说明（配置模板、故障排查、额度提示、配置项）见[插件文档](https://fnapps-doc.tnnevol.cn/plugins/dsh-midscene)。
