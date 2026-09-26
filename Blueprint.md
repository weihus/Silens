- 这份 `Project Blueprint.md` 是专为 **Vibe Coding**（AI 协作编程）优化的需求文档。它省去了啰嗦的背景描述，直接将设计共识转化为 AI 可理解的架构指令、约束条件和执行步骤。

  你可以将以下内容直接喂给 **Cursor、Windsurf** 或任何 AI 编程助手。

  # Project Blueprint: Silens (息壤) - Immersive Writing Space

  ## 0. 核心愿景 (The Vibe)

  - **定位**：一个极致极简、本地优先、零摩擦的 Markdown 沉浸式写作工具。
  - **设计原则**：启动即写、UI 随动消失、键盘优先、数据主权、拒绝干扰。
  - **视觉基调**：现代学术极简风。背景 `#FAF8F5` (暖白)，文字使用高质量衬线体 (Source Han Serif)。

  ## 1. 技术栈 (Tech Stack)

  - **外壳层**：Tauri v2 (Rust) - 确保极致轻量、启动速度及本地文件系统访问权限。
  - **前端框架**：React 18 + Tailwind CSS - 易于 AI 进行 UI 生成与样式调整。
  - **编辑器核心**：TipTap (ProseMirror) - 实现“所见即所得”的 Markdown 体验及高度定制化。
  - **状态管理**：Zustand - 轻量级、无样板代码。
  - **本地存储**：Tauri FS API (存储 .md 文件) + `localStorage` (存储用户偏好)。

  ## 2. 功能模块定义 (Functional Modules)

  ### M1: 沉浸式画布 (The Canvas)

  - **交互约束**：无标题栏、无边框。
  - **打字机模式**：当前编辑行始终垂直居中。
  - **UI 隐匿**：用户开始打字时，所有非文字元素（字数统计、设置按钮等）透明度变为 0；鼠标移动时恢复。
  - **排版规格**：最大行宽 720px，行高 1.8，字间距 0.05em。

  ### M2: 静默文件系统 (The Silent Disk)

  - **默认路径**：系统文档目录下的 `Silens_Notes/`。
  - **自动命名**：
    1. 首行若为 `# Title`，则文件名为 `YYYY-MM-DD_Title.md`。
    2. 若无标题，提取首行前 10 字符：`YYYY-MM-DD_前10字符.md`。
  - **自动保存**：防抖 (Debounce) 1500ms，输入停止后静默写入磁盘。

  ### M3: 分层召回系统 (Layered Recall)

  - **命令面板 (Cmd/Ctrl + K)**：
    - 模糊搜索所有 `.md` 文件内容及标题。
    - 支持自然语言搜索（如输入“昨天”、“上周”）。
  - **极简时间轴 (Side Drawer)**：
    - 左侧边缘 20px 触发区，悬停 300ms 滑出。
    - 纯文字列表，按月份归档。

  ### M4: 氛围模块 (Atmosphere)

  - **快捷键**：`Cmd/Ctrl + Shift + M` 呼出/隐藏面板。
  - **白噪音**：集成 Web Audio API，预设：细雨 (Rain)、篝火 (Fire)、咖啡馆 (Cafe)。
  - **视觉主题**：提供「纯白」、「纸张」、「深夜」三种纯色主题切换。

  ## 3. 数据 Schema 与文件结构 (Data & Structure)

  ### 文件存储格式

  ```text
  /Documents/Silens_Notes/
    ├── 2024-05-01_今日感悟.md
    ├── 2024-05-02_项目构思.md
    └── .silens_config (JSON - 存储主题、音量等偏好)
  ```

  ### 偏好设置 Schema

  ```json
  {
    "theme": "paper",
    "fontFamily": "Source Han Serif",
    "fontSize": 18,
    "lastAudio": "rain",
    "volume": 0.5,
    "enableSideDrawer": true
  }
  ```

  ## 4. 迭代路线图 (Implementation Roadmap)

  ### Phase 1: 核心编辑与自动保存 (MVP)

  1. 搭建 Tauri + React 基础脚手架。
  2. 实现 TipTap 编辑器，配置基础排版样式。
  3. 实现 Rust 后端监听前端变动，自动创建并保存 .md 文件。

  ### Phase 2: 沉浸式 UI 与交互增强

  1. 实现 UI 随动淡入淡出。
  2. 添加打字机模式 (Typewriter scrolling)。
  3. 实现 `Cmd + K` 搜索面板及文件切换逻辑。

  ### Phase 3: 氛围与多端导出

  1. 实现 Web Audio API 播放控制。
  2. 增加“一键复制为富文本”功能。
  3. 实现基于 `html2canvas` 的长图导出功能，支持自定义作者签名。

  ## 5. 关键 AI 提示词建议 (Key AI Prompts)

  > **Prompt 1 (初始化项目)**: "初始化一个 Tauri v2 项目，前端使用 React + Tailwind。要求窗口无边框 (transparent, decorless)，背景色设为 #FAF8F5。在用户文档目录自动创建一个名为 Silens_Notes 的文件夹。"

  > **Prompt 2 (编辑器逻辑)**: "使用 TipTap 实现一个 Markdown 编辑器。要求：1. 隐藏所有工具栏；2. 输入 `#` 时自动渲染为标题样式；3. 实现打字机模式，即光标所在行始终保持在屏幕中央。"

  > **Prompt 3 (搜索逻辑)**: "实现一个 Cmd+K 呼出的 React 组件。它需要读取本地 Silens_Notes 文件夹下的所有 .md 文件，并根据用户输入的关键词进行模糊匹配搜索，点击搜索结果后，在编辑器中加载该文件内容。"

  ## 6. 约束条件 (Constraints)

  - **性能**：应用在闲置时的内存占用应低于 100MB，打字延迟低于 16ms。
  - **开源友好**：代码结构清晰，所有配置项通过外部 JSON 读取，方便社区贡献主题。
  - **无劫持**：所有文章必须是标准 Markdown，严禁在文件中插入任何私有元数据。

  这个 Blueprint 已经准备就绪。你可以直接启动你的开发环境，配合这段文档开始构建你的「息壤」写作空间了。
