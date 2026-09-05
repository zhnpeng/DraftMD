# DraftMD

## 产品定位

DraftMD 是开源的 macOS AI Markdown 编辑器，由 ColaMD 衍生。用户在本地文件夹中编辑 Markdown，也可以通过内置 Agent 阅读、整理和修改工作区文档。外部工具修改文件时，编辑器同步变化并保护未保存的本地编辑。

当前产品范围以 [产品设计](docs/superpowers/specs/2026-08-31-draftmd-product-design.md) 为依据；实现状态和剩余发布工作见 [当前路线图](docs/roadmap.md)。上游历史不代表 DraftMD 的功能承诺。

## 核心工作流

1. 打开文件夹作为工作区，浏览 Markdown 文件和当前文档大纲。
2. 配置并测试模型服务，按实际能力区分 Agent、Chat only 和 Unavailable。
3. 在任务面板发起对话或文档任务；可以附带当前文档或选区上下文。
4. 查看流式回复、工具活动和删除审批；运行中的任务可以停止。
5. 查看文件变更和 Diff，按任务撤销；发生冲突时保留用户后续修改。
6. 在本地会话历史中继续工作，启动时处理被中断的任务。

## 安全和数据边界

- 文件工具只操作用户选定工作区内允许的 Markdown 文件，必须通过现有路径授权、版本检查和写入流程。
- 删除文档需要用户审批；Chat only 不提供文件工具。
- 不向模型提供 shell、网络浏览、MCP 或任意文件系统访问。
- 模型凭据和秘密请求头保存在 macOS Keychain，不进入 Renderer、SQLite、日志或诊断导出。
- 会话、任务和配置元数据保存在本地 SQLite；快照用于 Diff、Undo 和恢复。
- 启动恢复成功后，仅清理目录修改时间超过 30 天且没有任何任务引用的快照。数据库恢复异常或隔离备份存在时暂停清理。详细规则见 [隐私说明](docs/privacy.md)。
- 删除会话不删除 Markdown 文档。

## 界面约定

- 编辑器是视觉中心；保留轻量标题栏、可隐藏的文件与大纲面板、可收起的 Agent Dock。
- 不添加常驻格式工具栏或状态栏。复用已有控件、菜单和交互模式。
- 图标复用现有线性 SVG，统一尺寸、线宽和状态；图标按钮提供 tooltip、`title` 和 `aria-label`。
- 界面文案通过共享 i18n 同时支持英文和简体中文。
- 颜色使用语义 CSS 变量，新增变量时同步全部 12 个内置主题。
- 完整尺寸、布局和可访问性要求见 [design.md](design.md)。

## 范围限制

当前面向 macOS，不承诺 Windows、Linux、iOS 或 Web 支持。云同步、协作编辑、知识库和标签管理、自定义主题导入、Word/图片导出及多窗口产品体验不属于当前 MVP 的验收范围。保留的上游代码或内部窗口管理能力不等于已支持这些产品功能。自动更新尚未启用。

## 技术结构

- `src/main/agent/`：模型运行、任务生命周期、审批与恢复。
- `src/main/workspace/`：工作区与文件访问边界。
- `src/main/changes/`：快照、变更集、Diff、Undo 和保留策略。
- `src/main/persistence/`：SQLite 迁移与 repositories。
- `src/main/index.ts`：应用服务组装与启动。
- `src/shared/contracts/`：共享类型与 Zod 校验的 IPC 合约。
- `src/shared/i18n/`：双语文案。
- `src/preload/`：受限 IPC 桥接。
- `src/renderer/agent/`：Agent Dock 与会话交互。
- `src/renderer/editor/`、`src/renderer/themes/`：Milkdown 编辑器和主题。
- `tests/`：Vitest、集成、安全、性能及 Playwright Electron 测试。

## 开发与发布

使用 TypeScript 严格模式，保持编辑器、文件 I/O、IPC 和视觉样式的职责划分；优先遵循现有模块和 helper。行为改动增加对应回归覆盖，按 [CONTRIBUTING.md](CONTRIBUTING.md) 运行检查。

普通 push 和 PR 使用 `CI / macOS checks` 检查；发布由独立工作流处理。未发布改动不要写成已进入预览安装包。签名、公证、真实硬件和模型服务验证状态见 [当前路线图](docs/roadmap.md)。

保留 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md) 中的 ColaMD 来源、版权及第三方声明。演示和更新历史位于 `resources/demo/`，随实际发布更新。
