# codex-to-dsh-pet

把 **Codex 桌宠**（spritesheet 图集）移植为 **DeepSeek Harness（DSH）网页 GUI 桌宠**的通用框架 / 适配器。

- 零依赖的核心渲染器（纯 DOM，无构建步骤）
- 开箱即用的交互：拖拽（按方向奔跑）、悬停挥手、双击跳跃、眼睛跟随鼠标
- 实时响应 agent 活动状态，切换姿势
- 工作时头顶弹出**进度气泡**（工具名 / 流式文本 / "思考中…"）
- 逐行**尺寸归一化**，修正某些图集里姿势大小不一致的问题

> ⚠️ 本框架**不包含任何桌宠素材**。你需要自己准备一张拥有合法使用权的
> spritesheet，详见 [LEGAL.md](./LEGAL.md)。

## 快速开始

### 1. 准备素材

把一张 Codex 桌宠的 spritesheet（通常是 `spritesheet.webp`）放进本目录。

### 2. 配置

复制示例配置并修改：

```powershell
Copy-Item config.example.json config.json
```

`config.json` 字段：

| 字段 | 说明 | 默认 |
|---|---|---|
| `name` | 插件名（也是 node_modules 目录名 / 注册名） | `codex-to-dsh-pet` |
| `label` | 悬浮层里显示的标签 | `桌宠 Pet` |
| `spritesheetPath` | 图集相对路径 | `spritesheet.webp` |
| `spriteVersionNumber` | 图集版本：`1`（8×9）或 `2`（8×11，含注视帧） | `2` |
| `size` | 显示宽度 px | `120` |
| `pin` | 初始位置（`bottom-right` / `bottom-left` / …） | `bottom-right` |
| `normalize` | 可选：逐行尺寸归一化 `[null, …, { s, cx, cy }, …]` | 无 |
| `look.enabled` | 是否开启「眼睛跟随鼠标」；旧版桌宠（无注视帧）设为 `false` | `true` |
| `look.deadzone` | 注视死区（px，指针距桌宠中心小于该值不触发） | `28` |
| `bubble.enabled` | 是否显示进度气泡 | `true` |
| `bubble.maxChars` | 流式文本截取长度 | `140` |
| `bubble.runningText` | 工具运行时文案（`{tool}` 会被替换成工具名） | `运行中：{tool}…` |
| `bubble.workingText` | 工作但无工具名时的文案 | `工作中…` |
| `bubble.thinkingText` | 思考时的文案 | `思考中…` |

> 💡 **旧版（v1）桌宠**：很多较早的 Codex 桌宠图集只有 9 行、没有最后两行「注视」
> 帧。请把 `spriteVersionNumber` 设为 `1`（此时会自动忽略鼠标追踪、保持待机），
> 或把 `look.enabled` 设为 `false`。若你照搬 `config.example.json` 而忘了改
> `spriteVersionNumber`，渲染器会去读不存在的第 9、10 行而显示异常。

### 3. 构建

```powershell
node build.js
```

会读取 `config.json` + 图集，生成自包含的 `lib/client.js`。

构建后可以运行冒烟测试验证产物：

```powershell
node verify-bundle.cjs
```

### 4. 安装到 DSH

```powershell
.\install-to-dsh.ps1
```

脚本会把插件复制到 `~/.dsh/profiles/node_modules/<name>` 并注册到
`cordis.patch.yml`（幂等、自动备份）。

### 5. 重启并刷新

```powershell
dsh web
```

然后在浏览器硬刷新 `http://127.0.0.1:3080`（`Ctrl+Shift+R`），桌宠就出现在右下角了。

## 图集格式

Codex 桌宠图集是固定布局的精灵图：

| 项 | 值 |
|---|---|
| 帧尺寸 | 192 × 208 px |
| 列数 | 8 |
| v1 行数 | 9（1536 × 1872） |
| v2 行数 | 11（1536 × 2288，第 9、10 行是 16 方向注视帧） |

逐行动画（帧间隔 ms）：

| 行 | 动画 | 帧数 | 间隔 |
|---|---|---|---|
| 0 | idle 待机 | 6 | 160 |
| 1 | runningRight 向右跑 | 8 | 120 |
| 2 | runningLeft 向左跑 | 8 | 120 |
| 3 | waving 挥手 | 4 | 140 |
| 4 | jumping 跳跃 | 5 | 140 |
| 5 | failed 失败 | 8 | 140 |
| 6 | waiting / sleeping 等待·睡觉 | 6 | 150 |
| 7 | running 奔跑 | 6 | 120 |
| 8 | review 审阅 | 6 | 150 |
| 9–10 | look（16 方向注视） | 16 | — |

## 目录结构

```
.
├── config.example.json     # 示例配置
├── build.js                # 内联图集 + 配置 → lib/client.js
├── verify-bundle.cjs       # 构建产物冒烟测试
├── install-to-dsh.ps1      # 一键安装
├── lib/
│   ├── index.js            # 宿主（Node）半身
│   ├── client.template.js  # 浏览器半身源码模板
│   └── client.js           # 构建产物（build.js 生成，已 gitignore）
├── LEGAL.md                # 版权与许可说明
└── LICENSE
```

## 回滚

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\profiles\node_modules\<name>"
Copy-Item "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml.bak" `
          "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml" -Force
# 然后重启 dsh web
```

## 许可与版权

插件代码按 [MIT](./LICENSE) 授权。关于 Codex 桌宠素材/格式的版权说明，请阅读
[LEGAL.md](./LEGAL.md)。
