🌐 **中文** · [English](README.en.md)

# codex-to-dsh-pet

![banner](banner.png)

把 **Codex 桌宠**（spritesheet 图集）移植为 **DeepSeek Harness（DSH）网页 GUI 桌宠**的通用框架 / 适配器。
本项目系通过DSH编写，有问题和报错还请指正，我们会不断调试。

- 零依赖的核心渲染器（纯 DOM，无构建步骤）
- 开箱即用的交互：拖拽（按方向奔跑）、悬停挥手、双击跳跃、眼睛跟随鼠标（请注意，只有Codex桌宠v2版本（11行动作图片）才支持；运行时插件可在设置里关闭）
- 实时响应 agent 活动状态，切换姿势
- 工作时头顶弹出**进度气泡**（工具名 / 流式文本 / "思考中…"）
- 逐行**尺寸归一化**，修正某些图集里姿势大小不一致的问题

> ⚠️ 本框架（构建脚本）**不内置第三方桌宠素材**。随附的运行时插件内置一只
> **示例桌宠 `nastya`（娜斯佳，原创角色，CC BY-NC 4.0）**，仅用于演示，详见 [LEGAL.md](./LEGAL.md)。

## 推荐：运行时插件（装一次 + 图形界面导入）

`packages/dsh-codex-pet` 是一个**运行时插件**——装一次，之后在 DSH 设置里点按钮导入
`.webp` 图集即可，**不用再跑命令行**。支持换宠、大小、位置、气泡颜色/透明度、
鼠标视觉追踪（**仅 v2 图集**，默认开启，可关闭），并内置
一只示例桌宠 `nastya`（娜斯佳，原创角色，CC BY-NC）。

**安装（仅一次，任选其一）：**

**方式 A —— 一条命令（需要 pnpm）：**

```powershell
# 从 npm
dsh plugin --profile web add @signalight/dsh-codex-pet

# 或直接从 GitHub
dsh plugin --profile web add github:Signalight/codex-to-dsh-pet#path:/packages/dsh-codex-pet
```

**方式 B —— 脚本（无需 pnpm）：** 在解压出的 `codex-to-dsh-pet` 文件夹里打开 PowerShell（空白处 **Shift + 右键** → 在此处打开 PowerShell），运行：

```powershell
.\install-runtime.ps1
```

装完后：DSH 会热加载 `cordis.patch.yml`，直接浏览器硬刷新 `http://127.0.0.1:3080`（Ctrl+Shift+R）即可；若仍未出现，再完全退出并重启 DSH 桌面应用（命令行版则重启 `dsh web`）。

**之后加桌宠（全图形界面）：** 打开 **设置 → 桌宠**，点 **导入桌宠**，选一张 `.webp`
图集即可（可输入中文名，宠物 id 自动取自文件名；id 重复时自动加 `-2`/`-3` 后缀，
不会覆盖之前导入的桌宠）。详见
[packages/dsh-codex-pet/README.md](./packages/dsh-codex-pet/README.md)。

> 📢 **给早期用户**：如果你之前用下面「旧方法」给每只桌宠单独装过插件，它们**仍然
> 有效**，不会失效。想换到新方式：先跑一次上面的 `install-runtime.ps1` 装上运行时
> 插件，之后新桌宠都用「设置 → 桌宠 → 导入」添加；旧的每宠插件可保留，也可先用
> `.\select-pet.ps1` 停用，再手动删除 `profiles\node_modules\<宠物名>` 及补丁里的对应行。

---

## 旧方法：每宠构建一个插件（build.js）

### 安装步骤（零基础，照着做就行）

**开始前需要两样**：① 电脑装了 [Node.js](https://nodejs.org/)（运行 `node` 用）；② 已经装好、能跑起来的 DeepSeek Harness（DSH）。

**第 1 步：拿到代码**

- 点仓库页绿色 **Code → Download ZIP**，下载后**解压**，得到一个 `codex-to-dsh-pet` 文件夹；
- 或命令行克隆：`git clone https://github.com/Signalight/codex-to-dsh-pet.git`

**第 2 步：打开 PowerShell（位置要对）**

1. 用文件资源管理器进入解压出来的 `codex-to-dsh-pet` 文件夹；
2. 在文件夹**空白处**，按住 **Shift** 键 + **鼠标右键**；
3. 菜单里选 **"在此处打开 PowerShell 窗口"**（Windows 11 可能是"在终端中打开"，一样）。

窗口里光标前面显示着 `...\codex-to-dsh-pet`，就说明位置对了。

**第 3 步：放图集**

把桌宠图集（`.webp` 图片）**改名成你想叫的宠物名**（如 `nastya.webp`），**拖进** `codex-to-dsh-pet` 文件夹。

**第 4 步：运行两条命令**

在 PowerShell 窗口里依次输入下面两条，**每条输完按 Enter**：

```powershell
node build.js
```

```powershell
.\install-to-dsh.ps1
```

看到 `Done.` 就成功了。

**第 5 步：刷新生效**

DSH 会热加载 `cordis.patch.yml`，直接在浏览器**硬刷新** `http://127.0.0.1:3080`（`Ctrl+Shift+R`），桌宠就出现在右下角了 🎉（桌面应用无需重启；若仍未出现，完全退出并重启桌面应用；命令行版则重启 `dsh web`。）

> **常见报错**：
> - 出现「禁止运行脚本」→ 先输入 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 回车（选 `Y`），再重跑第 4 步。
> - 出现「`node` 不是内部或外部命令」→ 还没装 Node.js，去 [nodejs.org](https://nodejs.org/) 装一下。
> - 装了多个桌宠后想切换，用 `.\select-pet.ps1`（见下文）。

---

### 1. 准备素材

把一张 Codex 桌宠的 spritesheet **命名成你的宠物名**（如 `fluffy.webp`）放进本目录。
插件名会自动取自这个文件名——一张图集 = 一个插件。

### 2. 配置（可选）

`name` / `label` **不用填**（自动从图集文件名推导）。只有需要改尺寸、归一化、
气泡文案等时才建 `config.json`：

```powershell
Copy-Item config.example.json config.json
```

`config.json` 字段（`name`/`label` 可省略，缺省取图集文件名）：

| 字段 | 说明 | 默认 |
|---|---|---|
| `name` | 插件名（也是 node_modules 目录名 / 注册名） | **图集文件名** |
| `label` | 悬浮层里显示的标签 | **图集文件名** |
| `spritesheetPath` | 图集相对路径 | 自动检测 |
| `spriteVersionNumber` | 图集版本：`1`（8×9）或 `2`（8×11，含注视帧） | **自动检测**（按图集尺寸 1872/2288） |
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

> 💡 **版本自动识别**：build.js 会按图集尺寸自动判断 v1/v2——高 **1872px = v1**
> （9 行，无注视帧，自动关闭鼠标追踪），高 **2288px = v2**（11 行，含 16 方向注视帧，
> 自动开启鼠标追踪）。所以**一般不需要手动设 `spriteVersionNumber`**；只有当你的图集
> 不是标准尺寸时，才需要在 `config.json` 里显式指定。

### 3. 构建

```powershell
node build.js
```

会自动检测图集、从文件名推导宠物名，生成自包含的 `lib/client.js` 和
`config.effective.json`。

只想构建**指定的一张图集**时，可以用一步命令（写 `config.json` + 跑 `build.js`）：

```powershell
.\build-pet.ps1 nastya                                   # 名字与图集文件名一致
.\build-pet.ps1 nastya -NodePath C:\path\to\node.exe     # 指定 node 路径（一般不用）
```

构建后可以运行冒烟测试验证产物：

```powershell
node verify-bundle.cjs
```

### 4. 安装到 DSH

```powershell
.\install-to-dsh.ps1
```

脚本会自动定位 DSH home，复制插件到 `<DSH home>/profiles/node_modules/<name>`，
并注册到 `<DSH home>/profiles/web/cordis.patch.yml`（幂等、自动备份）。

> **DSH home 定位**（`install-to-dsh.ps1` / `select-pet.ps1` 通用，按序探测）：
> 1. `$env:DSH_HOME`（若已设置则优先）；
> 2. `~/.dsh`（命令行版 dsh 的常规位置，存在才用）；
> 3. `%APPDATA%\io.github.hairyf.deepseek-harness-desktop\data\dsh`
>    （DeepSeek Harness **桌面应用**的数据目录）。
>
> 命令行版用户通常在 `~/.dsh`；桌面应用版用户通常在 `%APPDATA%\...\data\dsh`。
> 注意：桌面应用**不会**把 `DSH_HOME` 导出到你的终端，脚本靠上面的探测自动找到。
> 探测逻辑统一放在 `dsh-home.ps1`（install / select 脚本共用），想自定义改它即可。

### 5. 刷新生效

DSH 会热加载 `cordis.patch.yml`，直接在浏览器硬刷新 `http://127.0.0.1:3080`（`Ctrl+Shift+R`）即可，桌宠就出现在右下角了。桌面应用无需重启；若仍未出现，完全退出并重启桌面应用。命令行版用户可重启 `dsh web`：

```powershell
dsh web
```

### 6. 选择激活哪个桌宠（仅旧式每宠插件）

`select-pet.ps1` 只管理**旧式每宠插件**（`build.js` 构建、位于 `node_modules` 顶层、
只有 `dsh.client` 的插件）：

```powershell
.\select-pet.ps1          # 交互菜单：输入序号切换，q 保存退出
.\select-pet.ps1 -List    # 只查看当前状态，不修改
```

它会扫描 `node_modules`（含 `@scope/` 子目录）里所有桌宠插件：旧式每宠插件可切换
激活状态；scoped 运行时插件（如 `@signalight/dsh-codex-pet`）仅作为信息列出、**不会
被本脚本改动**（其桌宠请在「设置 → 桌宠」里管理）。保存时只重写旧式每宠插件的
`- insert:` 行，其余补丁条目一律保留（自动备份）。改完浏览器硬刷新即可生效。

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
├── build.js                # 内联图集 + 配置 → lib/client.js（名字取自图集文件名）
├── verify-bundle.cjs       # 构建产物冒烟测试
├── build-pet.ps1           # 一条命令构建指定桌宠（可选 -NodePath）
├── dsh-home.ps1            # 共享的 DSH home 探测（install / select 共用）
├── install-to-dsh.ps1      # 一键安装
├── select-pet.ps1          # 选择激活哪个桌宠
├── README.md               # 中文说明
├── README.en.md            # English README
├── lib/
│   ├── index.js            # 宿主（Node）半身
│   ├── client.template.js  # 浏览器半身源码模板
│   └── client.js           # 构建产物（build.js 生成，已 gitignore）
├── LEGAL.md                # 版权与许可说明
└── LICENSE
```

## 回滚

```powershell
# 复用与安装脚本相同的 DSH home 探测（dsh-home.ps1）
. .\dsh-home.ps1
$profileDir = Join-Path (Get-DshHome) 'profiles\web'
$nodeModules = Join-Path (Split-Path -Parent $profileDir) 'node_modules'

Remove-Item -Recurse -Force (Join-Path $nodeModules '<name>')
Copy-Item "$profileDir\cordis.patch.yml.bak" "$profileDir\cordis.patch.yml" -Force
# 改完浏览器硬刷新即可（桌面应用会热加载；命令行版再重启 dsh web）
```

## 更新日志

- **2026-08-24** 运行时插件新增「鼠标视觉追踪」开关（设置 → 桌宠）：v2 图集的视线是否跟随鼠标，可在界面里自行选择，**默认开启**；界面会提示此功能**仅 v2 图集可用**（v1 无注视帧，设置不生效）。该项以服务端 `mouseTracking` 配置持久化。
- **2026-08-18** 修复（issue #3）：`select-pet.ps1` 现在也会扫描 scoped（`@scope/`）目录，运行时插件可见但仅展示、绝不改动；旧式每宠插件切换只重写自己的补丁行，其余条目一律保留（避免静默删除运行时插件等第三方条目）；`install-to-dsh.ps1` / `install-runtime.ps1` 与 README 的重启指引改为「热加载 + 硬刷新」，桌面应用无需也无法手动重启 `dsh web`。
- **2026-08-17** 修复（0.1.2）：导入新桌宠不再覆盖旧桌宠。此前桌宠 id 取自文件名，而 Codex 图集都叫 `spritesheet.webp`，导致第二次导入会覆盖第一次导入的文件夹；现在 id 冲突时自动追加 `-2`、`-3` 后缀，只有「同名同 id」的重复导入才原地更新（用于替换修复后的图集）。
- **2026-08-17** 新增运行时插件 `packages/dsh-codex-pet`：装一次即可，图形界面导入桌宠（webp/png/gif）、换宠 / 大小 / 位置 / 气泡颜色与透明度；示例桌宠改用原创角色 **nastya（娜斯佳）**，按 **CC BY-NC 4.0** 授权（详见 LEGAL.md）。
- **2026-08-17** 新增：英文版说明（`README.en.md`），README 顶部增加中/英切换链接；并给 GitHub 仓库添加了简介（description）与标签（topics，含 `dsh-plugin`）。
- **2026-08-17** 文档：示例宠物名不再使用游戏角色名 `anaxa`，改用原创角色 `nastya`。
- **2026-08-17** 重构：DSH home 探测抽到共享的 `dsh-home.ps1`（install / select 脚本与 README 回滚代码统一引用）；`build-pet.ps1` 新增 `-NodePath` 参数，不再依赖作者本机路径；`select-pet.ps1` 保存时保留注释位置与非桌宠补丁条目，与 `install-to-dsh.ps1` 行为一致。
- **2026-08-16** 修复：`build.js` 自动检测忽略仓库自带的 `banner.png`（此前必报「多张图集」）；`install-to-dsh.ps1` / `select-pet.ps1` 支持 `DSH_HOME` 三级探测（`$env:DSH_HOME` → `~/.dsh` → 桌面应用 `%APPDATA%\...\data\dsh`）；`install-to-dsh.ps1` 写补丁时丢弃 `[]` 占位符，修复生成的 `cordis.patch.yml` 为非法 YAML 的问题。
- **2026-08-16** 修复多桌宠同时加载报错（模板顶层 `const` 用 IIFE 包裹），现在可同时开启多个桌宠。
- **2026-08-16** `build.js` 按图集尺寸自动识别 v1/v2（高 1872px=v1、2288px=v2），v2 自动开启鼠标追踪，无需手填 `spriteVersionNumber`。
- **2026-08-16** 图集文件名自动推导宠物名（一张图集 = 一个插件）；`spritesheetPath` 过期时自动回退；新增 `select-pet.ps1` 切换激活。
- **2026-08-15** 修复安装脚本的 UTF-8 编码与目录创建问题；新增 `look` 配置（旧版 v1 桌宠可关闭注视）；README 增加「极简安装方法」。
- **2026-08-15** 初始版本：通用框架（渲染器 + DSH 适配层 + 进度气泡 + 拖拽 / 悬停挥手 / 双击跳跃 / 眼睛跟随 + 逐行尺寸归一化）。

## 许可与版权

- 插件代码按 [MIT](./LICENSE) 授权。
- 内置示例桌宠 `nastya`（娜斯佳）为**原创角色**，其图集按 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用）授权。
- 关于 Codex 桌宠素材/格式的版权说明，请阅读 [LEGAL.md](./LEGAL.md)。

## 致谢
感谢@tuskinekinase 提供灵感和鼓励~
