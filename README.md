# Linux.do 自动浏览助手 v2 2026

基于 Chrome MCP 研究分析的 Linux.do 论坛自动化浏览工具。

## v2.0 新特性

- **无限滚动支持** - 自动滚动加载更多内容
- **浏览记录管理** - 已浏览帖子标记，避免重复
- **完整回复浏览** - 滚动到底部浏览所有回复
- **自动循环** - 浏览完成后自动返回列表继续下一个
- **视觉标记** - 已浏览话题显示绿色勾号

## 项目结构

```
linuxdo/
├── README.md                              # 项目说明
├── docs/
│   ├── linux.do-analysis.md              # 网站结构分析报告
│   ├── implementation-plan.md            # 实现方案详细文档
│   └── usage-guide.md                    # 使用指南
└── src/
    ├── linuxdo-automation.user.js        # 油猴脚本 (主要功能)
    ├── hooks/                            # 调试Hook脚本
    │   ├── xhr-hook.js                   # XHR请求监控
    │   ├── fetch-hook.js                 # Fetch请求监控
    │   ├── cookie-hook.js                # Cookie读写监控
    │   ├── debugger-bypass.js            # 反调试绕过
    │   └── dom-observer.js               # DOM变化监控
    └── utils/                            # 工具脚本
        ├── discourse-api.js              # Discourse API封装
        └── page-analyzer.js              # 页面分析工具
```

## 功能特性

- **自动浏览话题列表** - 支持 /latest, /new, /unread, /top, /hot 等页面
- **无限滚动加载** - 自动滚动加载更多话题和回复
- **智能去重** - 已浏览帖子标记存储，避免重复浏览
- **完整回复浏览** - 帖子详情页滚动浏览所有回复直到底部
- **自动循环** - 浏览完成后自动返回列表继续下一个未浏览话题
- **随机点赞** - 按概率随机点赞（概率低/中/高/极高可在面板调节），带间隔控制
- **楼层限制** - 可设定每帖只浏览前 N 楼后换下一帖，并可选择只按未读楼层计数
- **断点续读** - 进入读过一部分的帖子时自动点击时间线「返回」，跳回上次读到的楼层继续
- **阅读量统计** - 监听 /topics/timings 阅读上报接口，面板实时显示本次总阅读量，页面刷新不清零
- **Credit 积分展示** - 面板显示 Credit（LDC）可用余额、社区积分、今日剩余额度与累计收支，依赖浏览器登录 credit.linux.do，带节流与 429 限流冷却
- **可视化控制面板** - 实时显示状态和统计数据，默认收起为悬浮球，可拖动到页面任意位置
- **视觉标记** - 已浏览话题显示绿色勾号，透明度降低
- **配置灵活** - 所有参数可调整

## 测试

油猴脚本主体在浏览器运行，仓库用 Node 内置测试器对纯函数（路径分类、话题 ID 提取、历史记录裁剪等）做单元测试：

```bash
npm test        # node --test，无需安装依赖
```

CI（`.github/workflows/ci.yml`）对所有跟踪的 JS 做 `node --check` 语法检查并跑单元测试。

## 快速开始

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [**点此一键安装**](https://raw.githubusercontent.com/liasica/linuxdo/feature/src/linuxdo-automation.user.js) —— Tampermonkey 会自动弹出安装确认页（也可手动新建脚本，复制 `src/linuxdo-automation.user.js` 内容）
3. 访问 https://linux.do 并登录
4. 页面右下角会出现紫色悬浮球，点击展开控制面板（拖动可移到任意位置）
5. 按需设置速度、列表、点赞与楼层限制，点击"开始自动浏览"

脚本已声明 `@updateURL`，安装后 Tampermonkey 会自动检查更新；`@name` 不含版本号，升级时直接覆盖安装即可。

### 工作流程

```
启动 → 判断页面类型
         ↓
    ┌────┴────┐
    ↓         ↓
 话题列表    帖子详情
    ↓         ↓
 滚动加载   标记已浏览
 找未浏览   滚动看回复
 点击进入   随机点赞
    ↓         ↓
    └────┬────┘
         ↓
      循环继续
```

## 技术说明

### 网站分析

- **论坛系统**: Discourse (开源论坛软件)
- **认证方式**: Cookie + CSRF Token
- **API风格**: RESTful JSON API
- **实时通信**: Message Bus 长轮询

### 关键发现

| 功能 | 实现方式 |
|------|---------|
| 点赞 | 调用 discourse-reactions API（`heart/toggle`），已赞检测 `.discourse-reactions-actions` |
| 帖子识别 | `article[id^="post_"]` |
| CSRF Token | `meta[name="csrf-token"]` |
| 登录检测 | 解析 `#data-preloaded`（JSON）中的 `currentUser` |

## 文档索引

- [网站分析报告](docs/linux.do-analysis.md) - 详细的页面结构和API分析
- [实现方案](docs/implementation-plan.md) - 代码架构和实现细节
- [使用指南](docs/usage-guide.md) - 安装配置和使用说明

## 注意事项

1. 仅供学习研究使用
2. 请遵守网站使用条款
3. 建议使用保守配置避免触发限制
4. 不得用于商业或恶意目的

## 调试工具使用

项目包含多个调试工具，可在浏览器控制台中使用：

### Hook脚本

```javascript
// 1. XHR监控 - 监控所有XMLHttpRequest请求
// 复制 src/hooks/xhr-hook.js 内容到控制台执行
getXhrLog()      // 查看请求日志
clearXhrLog()    // 清除日志

// 2. Fetch监控 - 监控所有Fetch API请求
// 复制 src/hooks/fetch-hook.js 内容到控制台执行
getFetchLog()    // 查看请求日志
clearFetchLog()  // 清除日志

// 3. Cookie监控 - 监控Cookie读写
// 复制 src/hooks/cookie-hook.js 内容到控制台执行
getCookieLog()   // 查看Cookie操作日志
parseCookies()   // 解析当前所有Cookie

// 4. DOM监控 - 监控页面DOM变化
// 复制 src/hooks/dom-observer.js 内容到控制台执行
startDomObserver('#topic')  // 开始观察指定元素
stopDomObserver()           // 停止观察
getDomLog()                 // 查看变化日志
```

### 工具脚本

```javascript
// 1. Discourse API工具
// 复制 src/utils/discourse-api.js 内容到控制台执行
await discourseAPI.getLatestTopics()     // 获取最新话题
await discourseAPI.getTopic(123456)      // 获取话题详情
await discourseAPI.likePost(789)         // 点赞帖子
await discourseAPI.getCurrentUser()      // 获取当前用户信息
await discourseAPI.search('关键词')       // 搜索

// 2. 页面分析工具
// 复制 src/utils/page-analyzer.js 内容到控制台执行
pageAnalyzer.printReport()       // 打印完整分析报告
pageAnalyzer.getPageInfo()       // 获取页面基本信息
pageAnalyzer.analyzeTopicPage()  // 分析帖子页面
pageAnalyzer.findLikeButtons()   // 查找所有点赞按钮
pageAnalyzer.getScrollInfo()     // 获取滚动状态
```

## 开发说明

### 技术栈

- **目标平台**: Discourse 论坛系统
- **实现方式**: Tampermonkey 用户脚本
- **API风格**: RESTful JSON
- **认证方式**: Cookie + CSRF Token

### 关键选择器

| 元素 | 选择器 |
|------|--------|
| 点赞按钮 | `button.btn-toggle-reaction-like`（旧版 `button[title="点赞此帖子"]` 已失效）|
| 帖子容器 | `article[id^="post_"]` |
| 话题链接 | `a[href*="/t/topic/"]` |
| 话题行 | `.topic-list-item, tr[data-topic-id]` |
| CSRF Token | `meta[name="csrf-token"]` |
| 登录状态 | `#data-preloaded`（含 `currentUser`），回退 `#current-user` |

### 数据存储

脚本使用 localStorage 存储以下数据：

| Key | 说明 |
|-----|------|
| `linuxdo_viewed_topics` | 已浏览话题ID列表 (JSON数组) |
| `linuxdo_liked_posts` | 已点赞帖子ID列表 (JSON数组) |
| `linuxdo_auto_running` | 自动运行状态 (用于页面跳转后恢复) |
| `linuxdo_session_read_keys` | 本次总阅读量去重键列表，「话题ID:楼层号」(JSON数组) |
| `linuxdo_session_read_epoch` | 阅读量清零代次标记 (用于多标签页同步) |
| `linuxdo_floor_limit` | 每帖浏览楼层上限 (0 表示不限) |
| `linuxdo_floor_limit_unread_only` | 楼层限制是否只计未读楼层 |

### 扩展开发

如需添加新功能，可参考以下步骤：

1. 使用 Hook 脚本分析目标功能的网络请求
2. 使用页面分析工具定位 DOM 元素
3. 参考 `discourse-api.js` 封装新的 API 调用
4. 在主脚本中添加新功能模块

## 已知限制

1. 网站可能更新页面结构，导致选择器失效
2. 频繁操作可能触发速率限制 (429 错误)
3. 长时间运行可能被检测为异常行为
4. 部分功能需要特定用户等级权限

## 更新日志

### v2.4.2 (2026-08-31)
- **变更** - 点赞关闭时隐藏「概率」整行：此时概率不参与任何判断，留在面板上只会让人以为还在生效
- **新增** - 楼层限制的输入框与「只计未读楼层」下方各补一行说明，讲清 N 的含义与两种计数口径的差别

### v2.4.1 (2026-08-31)
- **修复** - 登录检测适配 Discourse 新版页面结构：`#data-preloaded` 由 `<div data-preloaded="...">` 变为 `<script type="application/json">`，数据移到文本内容里；改为优先读 `textContent`、回退 `dataset` 兼容旧版，恢复「服务端直出即时判定登录、避免与 Ember 渲染竞速」（旧代码在新版会退化为依赖异步渲染的 `#current-user`，慢环境下刷新后面板可能不显示）
- **新增** - 控制面板补上点赞概率选择器（低 5% / 中 15% / 高 25% / 极高 40%）：概率预设与 `setLikeChance()` 早已就绪却未接入 UI，此前只能改 GM 存储值
- **清理** - 移除死代码 `checkLikeLimitDialog()`、精简 `handleLikeLimit()`：点赞走 API 直连，命中 429 直接关点赞开关，不再检测或关闭 UI 对话框
- **其他** - 统一注释标点为全角

### v2.4.0 (2026-08-31)
- **新增** - 楼层限制：面板可填写每帖只浏览前 N 楼，读满即换下一帖，留空或 0 表示不限
- **新增** - 楼层限制可勾选「只计未读楼层」，已读楼层滚过不计数，只数上次阅读位置之后的新楼层
- **新增** - 断点续读：进入读过一部分的帖子时，自动点击右侧时间线的「返回」跳回上次读到的楼层继续，不再从第一楼重刷已读内容
- **变更** - `@name` 去掉版本号，升级时可直接覆盖安装；补充 `@downloadURL` 与 `@updateURL` 支持自动更新
- **其他** - README 补充一键安装链接；新增仓库 `.gitignore`

### v2.3.0 (2026-08-31)
- **新增** - 控制面板可拖动：按住标题栏（收起态即悬浮球本身）拖到页面任意位置，松手后记住位置，窗口缩放时自动收回可视范围内
- **变更** - 面板默认收起为右下角悬浮球，点击展开；展开/收起状态与位置一并持久化
- **优化** - 重做面板样式：悬浮球运行中显示绿点与呼吸光环，展开与收起均带淡入淡出过渡，分段选择器等宽对齐，按钮与统计区重新排版

### v2.2.1 (2026-08-21)
- **修复** - 同一标签页翻页/刷新后被误判为「多开限制，未自启」：标签页 ID 改用 `sessionStorage` 持久化（按标签页稳定、整页跳转后保留），不再每次页面加载随机生成导致锁里的 ID 对不上自己
- **修复** - 点赞去重键改用全局 `data-post-id`：原先用话题内楼层序号，跨话题会碰撞，导致未点过赞的帖子被误判为已赞而漏赞
- **修复** - 已点赞检测：改为检测 discourse-reactions 插件的 `.discourse-reactions-actions` 容器已反应状态（旧的按钮 class 判断对该插件恒不生效），避免对已赞帖再次 toggle 反而取消赞
- **修复** - `beforeunload` 不再误释放防多开锁（脚本自身翻页也会触发页面卸载）：锁改为依赖心跳超时与手动停止时释放
- **修复** - 浏览记录持久化改为节流写入、页面卸载时仅在有待写数据时兜底落盘，避免存储读取失败时用空数据覆盖已有历史
- **优化** - 浏览/点赞记录上限 5000 条，超出按最旧淘汰，避免长期运行无限膨胀
- **优化** - 滚动时跳过已处理楼层的布局计算，减少强制回流
- **重构** - 合并四处重复的浏览器创建逻辑（`runBrowserFor`）与页面类型判断（`getPageTypeFromPath`）
- **其他** - 调试日志默认关闭（`GM_setValue('debug', true)` 可开启）；点赞去重键格式变更时一次性重置 `liked_posts` 旧数据

### v2.2.0 (2026-08-20)
- **新增** - 阅读量统计：监听 `/topics/timings` 阅读上报接口，上报成功后按「话题:楼层」去重累计
- **新增** - 控制面板显示「本次总阅读量」，计数持久化存储，页面刷新/跳转后延续
- **新增** - 手动点击「开始自动浏览」时清零本次总阅读量（自动恢复运行不清零）

### v2.1.0 (2026-02-27)
- **新增** - 防多开机制：每个标签页生成唯一 ID 并维护心跳锁，检测到其他标签页正在运行时取消自动恢复，避免多页同时自启动导致浏览器卡死
- **新增** - 手动开始时若检测到其他页面正在运行，弹窗确认是否强制接管；页面关闭时自动释放占用锁
- **修复** - 整页刷新后控制面板不显示：改用服务端直出的 `#data-preloaded` 判断登录状态，消除与 Ember 渲染的竞速，无法判定时轮询重试最多 10 秒
- **优化** - 精简代码，移除冗余注释

### v2.0.0 (2026-01-30)
- **重构** - 完全重写滚动和浏览逻辑
- **新增** - 无限滚动支持，自动加载更多内容
- **新增** - 浏览记录管理，避免重复浏览
- **新增** - 完整回复浏览，滚动到底部加载所有回复
- **新增** - 自动返回列表继续下一个话题
- **新增** - 视觉标记（已浏览话题显示绿色勾号）
- **新增** - 清除浏览记录功能
- **优化** - 更智能的内容加载检测
- **优化** - 控制面板显示更多统计信息

### v1.0.0 (2026-01-30)
- 初始版本
- 实现自动浏览话题列表
- 实现帖子页面自动滚动
- 实现随机点赞功能
- 添加可视化控制面板
- 添加调试工具集

## License

MIT License - 仅供学习研究
