# fnOS

`@tnnevol/dsh-fnos` 为 DSH 提供 fnOS 系统集成，包括访问已授权的 NAS 目录、打开文件和导出会话日志。

## 安装

在 fnOS 上使用 DSH 时，插件随应用安装或升级自动安装。其他 DSH 环境可执行：

```sh
dsh plugin --profile web add @tnnevol/dsh-fnos@0.1.7-rc.2
```

安装后重启 DSH Web profile。插件版本信息见[插件总览](/plugins/)。

## 在 fnOS 中使用

文件授权和系统文件操作需要从 fnOS 应用入口打开 DSH。普通浏览器仍可使用 DSH 的基本功能，但无法调用 fnOS 的目录授权和系统文件操作。

```mermaid
flowchart TD
    A[从 fnOS 应用打开 DSH] --> B[授权 NAS 目录]
    B --> C{选择后续操作}
    C --> D[选择工作区]
    C --> E[在对话中引用文件或目录]
    D --> F[开始对话]
    E --> F
    F --> G[在 fnOS 文件管理器打开文件]
    F --> H[导出会话日志到电脑或 NAS]
```

## 授权目录与文件

在「插件」中打开 `fnos` 详情页，选择「添加授权目录」并在 fnOS 窗口中确认。授权后可在工作区选择器中使用目录，也可在对话中选择文件或目录作为上下文。

你可以在插件详情页取消自己授予的目录权限；应用提供的共享目录仅供查看，不能从这里取消。

![fnOS 授权目录设置页](</images/plugins/dsh-fnos/authorized-directories.jpg>)

在 fnOS 中点击对话、工具结果或生成文件里的路径，可交由系统文件管理器打开。会话日志菜单支持下载到当前电脑，或导出到已授权的 NAS 目录。

![fnOS 会话头部文件入口](</images/plugins/dsh-fnos/header-file-entry.jpg>)

![fnOS 会话日志导出菜单](</images/plugins/dsh-fnos/session-log-export.jpg>)

## 主题

DSH 主题设为「跟随系统」时会跟随 fnOS 当前主题；如果在 DSH 中明确选择浅色或深色，则以该选择为准。

## 常见问题

### 授权目录列表为空

确认已从 fnOS 应用入口打开 DSH，并在 fnOS 授权窗口中授予目录访问权限。普通浏览器无法提供完整的 fnOS 文件能力。

### 文件无法打开

确认该路径存在，并且当前 fnOS 用户有权访问。出现在授权目录中不代表目录内的每个文件都存在或可访问。

### 主题没有跟随 fnOS 变化

确认 DSH 主题设置为「跟随系统」；手动选择浅色或深色时，DSH 会优先使用该设置。
