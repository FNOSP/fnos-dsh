# fnOS DSH

<p align="center">
  <img src="docs/public/icons/dsh-logo.svg" alt="DeepSeek Harness Logo" width="128">
</p>

[![GitHub](https://img.shields.io/badge/GitHub-FNOSP%2Ffnos--dsh-181717?logo=github&logoColor=white)](https://github.com/FNOSP/fnos-dsh)
[![GitHub stars](https://img.shields.io/github/stars/FNOSP/fnos-dsh?style=flat-square)](https://github.com/FNOSP/fnos-dsh/stargazers)
[![License](https://img.shields.io/github/license/FNOSP/fnos-dsh?style=flat-square)](LICENSE)

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11.16%2B-F69220?logo=pnpm&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-000000?logo=turborepo&logoColor=white)
![VitePress](https://img.shields.io/badge/VitePress-646CFF?logo=vite&logoColor=white)
![Semi Design](https://img.shields.io/badge/Semi%20Design-UI-1664FF)
![fnOS](https://img.shields.io/badge/fnOS-Native-1677FF)

飞牛 fnOS 上的 DeepSeek Harness 应用与插件生态项目。

## 项目简介

本项目用于将 DeepSeek Harness 适配并打包为可安装的 fnOS 应用，同时维护可独立安装到 DSH 客户端的插件和配套工具。

项目面向两类场景：

- 在飞牛 fnOS 上安装和运行 DeepSeek Harness
- 为 DSH 客户端开发、构建和发布扩展插件

## 核心能力

- 提供 DeepSeek Harness 的 fnOS Native 应用适配
- 支持 fnOS 应用的安装、升级、卸载和运行时管理
- 提供 fnOS 网关代理和 DSH Web 运行环境适配
- 支持 DSH 客户端插件及共享 UI 组件开发
- 提供本地 DSH Web、插件和文档开发能力
- 通过统一 CLI 管理检查、构建、版本和发布流程

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 包管理 | pnpm Workspace |
| Monorepo | Turborepo |
| 开发语言 | TypeScript、Shell |
| 构建工具 | tsdown、Vite、fnpack |
| 文档 | VitePress、Mermaid |
| UI | Semi Design |
| 应用形态 | fnOS Native |
| 运行环境 | Node.js 24、pnpm 11 |

## 快速开始

### 环境要求

- Node.js 24 或更高版本
- pnpm 11.16 或更高版本

### 安装依赖

```bash
nvm use
pnpm install
```

### 启动开发环境

```bash
pnpm run start
```

也可以按需启动文档站、插件或本地 DSH Web：

```bash
pnpm run start -- --docs
pnpm run start -- --plugin fnos
pnpm run start -- --web
```

### 构建与检查

```bash
pnpm run build -- --plugin fnos
pnpm run build -- --fpk --app fn-deepseek-harness
pnpm run check -- --all
```

## 文档

- [快速开始](docs/guide/quick-start.md)
- [开发环境](docs/development/environment.md)
- [应用开发](docs/development/app-structure.md)
- [插件开发](docs/development/plugin-development.md)
- [构建与打包](docs/build/fnpack.md)
- [版本与发布](docs/build/release.md)

本地预览文档站：

```bash
pnpm run start -- --docs
```

## 开源协议

[GNU Affero General Public License v3.0](LICENSE)
