# DraftMD

> 开源的 macOS AI Markdown 编辑器。

源码已加入 Windows x64 候选适配，尚待 Windows 实机验收；Release 下载仍仅面向 macOS。见 [Windows 构建与测试](docs/windows.md)。

**Language / 语言: [English](README.md) · [中文](README_CN.md)**

DraftMD 将可视化 Markdown 编辑器与内置 AI Agent 结合。选择本地文件夹并配置模型服务后，可以让 Agent 阅读、整理和修改文档，检查变更，并按任务撤销。外部工具修改文件时也会实时同步，同时保护尚未保存的本地编辑。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能

- **内置 Agent 与聊天**：流式回复、工具活动、文件删除审批和任务停止；模型配置经测试后区分 Agent、Chat only 与 Unavailable。
- **可检查的文档变更**：按任务查看文件变化和 Diff，支持带冲突检查的撤销与中断任务恢复。
- **本地会话**：按工作区保存历史，支持文档与选区上下文，凭据保存在系统凭据库（macOS Keychain / Windows 凭据管理器）。
- **实时 Agent 同步** — 外部文件变化实时显示在编辑器中。
- **真正的所见即所得** — 直接以富文本方式编辑 Markdown，无需分屏预览。
- **文件与大纲**：打开文件夹作为工作区，浏览其中的 Markdown 文件，或按标题导航文档。
- **源码模式** — 随时切换到原始 Markdown，进行精确编辑。
- **Markdown 常用能力** — 支持待办、高亮、KaTeX 公式、Mermaid 图表、搜索与智能换行。
- **内置主题** — 提供 12 个浅色和深色主题。
- **PDF 与 HTML 导出** — 按当前样式导出文档。
- **macOS Universal 应用**：打包目标为 Apple silicon、Intel 和 macOS 13 及以上；Intel 实机与 macOS 13 运行验证仍属发布前待办。
- **极简设计** — 没有常驻工具栏或状态栏。

## 开始使用

1. 从 [Releases](https://github.com/zhnpeng/DraftMD/releases/latest) 安装正式版，并阅读 [0.1.1 安装说明](docs/releases/v0.1.1.md) 中的未签名限制。
2. 打开存放 Markdown 文档的文件夹。
3. 配置模型服务并运行能力测试，具体支持情况见 [模型服务兼容性](docs/provider-compatibility.md)。
4. 在 Agent Dock 发起会话。Agent 配置可以调用工作区文件工具，Chat only 配置提供文字建议。
5. 检查文档变更和删除审批，保留结果或使用撤销。

本文描述当前源码。本次发布内容见 [0.1.1 发布说明](docs/releases/v0.1.1.md)，剩余验证见 [当前路线图](docs/roadmap.md)。本地存储、快照保留及发送给模型的数据范围见 [隐私说明](docs/privacy.md)。

## 开发

需要 Node.js 22.12 或更高版本，以及 macOS 或 Windows x64（候选适配）。Windows 使用 `npm run dist:win` 构建；测试范围见 [说明](docs/windows.md)。

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run test
npm run typecheck
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:performance
npm run build
npm run check:theme-colors
```

构建 macOS Universal 安装包：

```bash
npm run dist:mac
```

当前 GitHub Release 与本地构建均未签名、未公证。可选命令 `npm run dist:mac:signed` 需要 Apple Developer ID 与公证凭据；是否签名与 GitHub 正式发布状态互不绑定。

## 文档

- [当前状态与路线图](docs/roadmap.md)
- [候选需求与延期范围](docs/feature-requests.md)
- [发布检查清单](docs/release-checklist.md)
- [隐私说明](docs/privacy.md)
- [模型服务兼容性](docs/provider-compatibility.md)
- [参与贡献](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [来源与归属](NOTICE.md)

## 项目来源

DraftMD 是 [ColaMD](https://github.com/marswaveai/ColaMD) 的修改衍生项目。ColaMD 最初由 marswave.ai 开发并以 MIT 协议发布；DraftMD 保留上游版权与许可声明。项目来源和内嵌第三方软件信息见 [NOTICE.md](NOTICE.md)。

## 开源协议

[MIT](LICENSE)。版权和归属信息保留在协议与通知文件中。
