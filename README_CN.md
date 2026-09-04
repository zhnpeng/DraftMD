# DraftMD

> 开源的 macOS AI Markdown 编辑器。

**Language / 语言: [English](README.md) · [中文](README_CN.md)**

DraftMD 是一款专注于人与 AI Agent 协作的 Markdown 编辑器。外部工具修改正在打开的 `.md` 文件后，DraftMD 会实时同步变化，同时保护尚未保存的本地编辑。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能

- **实时 Agent 同步** — 外部文件变化实时显示在编辑器中。
- **真正的所见即所得** — 直接以富文本方式编辑 Markdown，无需分屏预览。
- **文件与大纲** — 浏览同目录 Markdown 文件，或按标题导航文档。
- **源码模式** — 随时切换到原始 Markdown，进行精确编辑。
- **Markdown 常用能力** — 支持待办、高亮、KaTeX 公式、Mermaid 图表、搜索与智能换行。
- **内置主题** — 提供 12 个浅色和深色主题。
- **PDF 与 HTML 导出** — 按当前样式导出文档。
- **macOS Universal 应用** — 一个安装包同时支持 Apple silicon 与 Intel，最低 macOS 13。
- **极简设计** — 没有常驻工具栏或状态栏。

## 开发

需要 Node.js 22.12 或更高版本，以及 macOS。

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run test
npm run typecheck
npm run build
npm run check:theme-colors
```

构建 macOS Universal 安装包：

```bash
npm run dist:mac
```

签名与公证需要配置发布工作流中列出的 Apple 凭据。本地构建默认不签名。

## 文档

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
