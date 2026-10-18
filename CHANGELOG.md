# Silens 更新记录

## v1.2.0 — 2026-10-18

- 新增应用内版本检查、更新说明、下载进度与确认安装；后台检查仅在空闲时轻提示，不自动下载安装。
- 安装前先保存笔记并创建备份，失败时中止安装并允许重试；更新包使用签名验证。
- 发布流程新增签名更新包和 `latest.json`，校验发布标签与应用版本一致；Linux 内置更新适用于 AppImage。
- 新增产品介绍页，提供实际界面截图、主题预览、跨平台下载入口与常见问题。

升级说明：v1.1.0 及更早的公开安装包没有更新功能，需要手动安装 v1.2.0 一次；此后发布更高版本时可在应用内更新。更新检查不上传笔记。

## v1.1.0 — 2026-10-15

本次为保留现有 Markdown 格式的次版本更新，重点改善保存可靠性、回顾交互和界面美学。

### 保存与数据保护

- 修复历史笔记始终写入今天文件的问题；保存绑定当前文件并按顺序执行，切换前完成待保存内容。
- 支持清空已有笔记；区分文件不存在与读取失败，保存错误明确显示并保留当前文字。
- 比较磁盘基线以检测外部修改，支持保留草稿副本后重新读取。
- 关闭窗口前等待保存和备份完成；备份先暂存、复制校验，再发布和执行保留策略。
- 工作区迁移复制并校验 Markdown、保留原文件，拒绝覆盖内容不同的同名目标文件；迁移后刷新当前笔记。
- SQLite 索引移至应用本地数据目录；工作区不可用时不再静默切换到默认目录。

### 编辑与交互

- 改善中文输入法与标签、Wiki 链接补全的按键协调，修复 Wiki 链接点击跳转。
- 取消因尖括号内容而阻止保存的判断；保留导入 Markdown 的标题与代码结构，修复代码块内连续空行。
- 修正搜索跳转后的滚动抢占，支持系统减少动态效果。
- 增加当前文档日期、回到今天和明确的侧栏固定/关闭入口。
- 空结果提示自动消失；日期区间区分加载、空结果与错误，并忽略过期响应。
- 统一搜索、设置、导出的互斥与焦点恢复，支持对话框 Tab/Escape，避免错误提示盖住导出。
- 修复文本导出路径与图片二进制写入；环境音静音时不再播放专注结束提示音。

### 界面

- 暖白纸面、柔和墨色和灰绿色辅助控件，改善辅助文字可读性。
- 搜索空状态改为紧凑单列，移除重复标题和表情装饰，有结果才显示预览；窄窗口隐藏预览。
- 去除输入区域的大块焦点外框，保留按钮键盘焦点提示。
- 侧栏不再因鼠标移出关闭；停笔约 2.2 秒后平缓恢复辅助界面，减少短暂停顿时闪现。
- 修复起笔提示叠在已加载正文上的问题。

### 开发与验证

- macOS 原生 Cargo 启动器解决 Apple Silicon Rosetta 终端的 `cc/xcrun` 链接失败。
- 对齐 npm、Cargo、Tauri 与锁文件版本号为 1.1.0。
- 本地验证：前端生产构建、54 个前端测试、5 个 Rust 测试；浏览器验证搜索、预览、窄屏与侧栏，文件接口采用隔离模拟。
- Windows/Linux 安装包由现有 GitHub Actions 构建；原生输入法、系统对话框及跨设备云同步尚未完成全平台人工验收。

### 升级说明

- 笔记仍为普通 `.md` 文件，无需转换。建议升级前额外复制一份笔记目录。
- 旧工作区中的索引可保留，新版使用应用本地索引；不要将索引当作笔记备份。
- 备份恢复仍为手动复制，尚无恢复向导；Wiki 链接为正向导航，反向链接待开发。
- Documents 可能受云同步管理；冲突检查不等同于跨进程锁或并发合并。

### English summary

Silens 1.1.0 improves current-file saving, conflict-copy recovery, verified snapshots, workspace migration, IME completion, Wiki links, Markdown preservation, and exports. The interface now offers compact search, contextual previews, clearer secondary controls, deliberate sidebar dismissal, and calmer transitions. Existing Markdown notes remain compatible. Native cross-platform interactions and concurrent cloud edits still require further manual validation.
