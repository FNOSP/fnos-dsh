# 在 GitHub Actions 中运行

Midscene 提供 [midscene-action](https://github.com/marketplace/actions/midscene-action)，用于在 GitHub Actions 中运行 Midscene Test。

- 自动把测试结果汇总到工作流的 **Summary**
- 把 HTML 报告和测试数据保存为 **Artifacts** 供下载
- 按需把报告发布到 **Cloudflare Workers**，通过链接在线预览

> ⚠️ **快照提示**：本页对应站点页面 `midscene-test/github-actions`，**截至 v1.16.0 的 release 尚未包含该源文件**（站点已发布、release 还没跟上）。内容以线上页面为准，后续版本锁定时再并入子模块快照。

## 官方示例

- [Basic](https://github.com/web-infra-dev/midscene-action/blob/main/.github/workflows/example-basic.yml)：用 AI 提交问候表单并检查结果
- [TodoMVC](https://github.com/web-infra-dev/midscene-action/blob/main/.github/workflows/example-todomvc.yml)：用 AI 管理待办事项，并通过自定义 Node 验证结果

## 接入工作流

运行 Action 前先安装测试依赖、准备浏览器或设备，并配置模型。然后在工作流中添加：

```yaml
- name: Run Midscene tests
  id: midscene
  uses: web-infra-dev/midscene-action@v1
  with:
    working-directory: tests/midscene
    command: pnpm test
```

- `working-directory`：测试项目相对仓库根目录的路径；在根目录时填 `.`
- `command`：在测试项目目录中执行的命令，默认 `npx midscene-test`，可换成项目已有命令

## 1. 配置模型

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `MIDSCENE_MODEL_API_KEY` | 模型服务的 API Key |
| Variable | `MIDSCENE_MODEL_NAME` | 模型名称 |
| Variable | `MIDSCENE_MODEL_BASE_URL` | 模型服务地址 |
| Variable | `MIDSCENE_MODEL_FAMILY` | 模型系列，按所选模型填写 |

其余变量见 [model-config.md](../model-config.md)。

## 2. 完整工作流示例

以 `tests/midscene` 下的测试项目为例。**接入前先确认项目在本地能正常执行**。

```yaml filename=.github/workflows/midscene.yml
name: Midscene E2E Tests

on:
  push:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      MIDSCENE_MODEL_API_KEY: ${{ secrets.MIDSCENE_MODEL_API_KEY }}
      MIDSCENE_MODEL_NAME: ${{ vars.MIDSCENE_MODEL_NAME }}
      MIDSCENE_MODEL_BASE_URL: ${{ vars.MIDSCENE_MODEL_BASE_URL }}
      MIDSCENE_MODEL_FAMILY: ${{ vars.MIDSCENE_MODEL_FAMILY }}
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 9.3.0
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - name: Install dependencies and browser
        working-directory: tests/midscene
        run: |
          pnpm install --frozen-lockfile
          pnpm exec playwright install --with-deps chromium
      - name: Run Midscene tests
        id: midscene
        uses: web-infra-dev/midscene-action@v1
        with:
          working-directory: tests/midscene
          command: pnpm test
```

根据实际情况调整 `working-directory` 和 `command`。完整参数见 [midscene-action 文档](https://github.com/web-infra-dev/midscene-action#inputs)。

## 3. 发布报告到 Cloudflare Workers（可选）

设 `publish-pages: true` 即可发布。每次运行生成独立预览链接，显示在工作流 Summary 中。

### 托管费用与限制

- **免费托管**：静态文件的存储和访问不收费
- **保留上限**：免费方案每个 Worker 最多保留 **100 个 Preview**，超限时 Cloudflare 删除最久未部署的
- **文件限制**：免费方案每个 Worker 版本最多 **20,000 个文件**，单个文件最大 **25 MiB**

### 创建 API Token

| Worker 配置 | 准备工作 | API Token 权限 |
| --- | --- | --- |
| **⭐ 使用已有 Worker（推荐）** | 在 **Workers & Pages** 创建 Worker，把 `cloudflare-worker-name` 设为它的名称；在 **Domains → Worker URL** 开启 **Preview** | 选 **Specified Workers**，勾选 **Individual Workers → Editor** |
| 由 Action 创建 Worker | 把 `cloudflare-worker-name` 设为需要的名称 | 选 **Entire Account**，勾选 **Workers → Admin** |

保存弹窗中的 API Token 和 Account ID（**Token 仅显示一次**）。

### 启用发布

添加仓库 Secret `CLOUDFLARE_API_TOKEN`、仓库变量 `CLOUDFLARE_ACCOUNT_ID`，然后：

```yaml
- name: Run tests and publish reports
  id: midscene
  uses: web-infra-dev/midscene-action@v1
  with:
    working-directory: tests/midscene
    command: pnpm test
    publish-pages: true
    cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    cloudflare-account-id: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

用已有 Worker 时把 `cloudflare-worker-name` 设为它的名称；默认值为 `midscene-reports`。

## 读取 Action 输出

给 Action 步骤设 `id: midscene` 后，通过 `${{ steps.midscene.outputs.<name> }}` 读取：

| 输出 | 用途 |
| --- | --- |
| `test-result` | 测试命令的执行状态 |
| `artifact-url` | 已上传 Artifact 的下载页面链接 |
| `report-artifact-name` | 已上传 Artifact 名称；未上传文件时为空 |
| `page-url` | 在线报告链接；发布未成功时为空 |
| `publication-result` | 发布步骤状态：`success` / `failure` / `skipped` / `cancelled` |