# OpenGlyph for DeepSeek Harness

把古文字工具链注册为 DeepSeek Harness（`dsh`）的原生工具，让模型知道每个工具**何时用、输入什么、返回什么、下一步做什么**，并直接看到字形图片。不是再放一份“请运行 CLI”的笼统提示。

适合古籍、甲骨、金文、简帛等材料的字形证据采集，以及生僻隶定字的字体与 LaTeX 排印。字形检索不等于释读，生成字体不等于字形已经核定。

## 为什么做这个插件

`guwenzi-tools tools --server` 已有机器可读输入接口，但普通终端调用不会把它们自动注册进模型的工具列表，返回字段和操作后续也需要领域说明。例如：

- `transcribe` **只是保存已有释文，不会 OCR**。
- `glyph_register` 保存没有释读的原字图身份，**不会生成字体**。
- `glyph_template_search` 找可编辑底字/部件；找不到完全相同的整字时，可继续修改部件，而不是换成相似常用字。
- `glyph_compose` 真正生成 SVG、OTF/TTF、码位映射、可复制文本、嵌入字体 Word 和 LaTeX 包。
- DINO 返回相似候选，不能用高分代替原图—最终字体比较，更不能代替人工核定。

本插件注册 **20 个原子工具 + 7 个辅助工具**，附带专门的领域工作流。工具的原生描述同时解释输入和输出；需要深入参数时，模型可调用 `gwz_catalog`。完整参考见 [工具参数与返回](docs/TOOLS.md)。

## 安装：这些命令粘贴到终端

首版实际测试的 Harness SDK 为 **0.2.1-rc.5**，Node.js 要求 **24.9+**。没有声称兼容未测试的 alpha 版本；先用 `dsh --version`、`node --version` 确认。如果本机找不到 `dsh`，先按 [DeepSeek 官方安装说明](https://github.com/deepseek-ai/deepseek-harness) 安装 Harness。

### 1. 安装 CLI 并登录自己的 OpenGlyph 账号

```sh
python3 -m pip install -U 'guwenzi-tools>=0.6.0'
guwenzi-tools login
guwenzi-tools doctor --quick
```

按浏览器提示完成授权后回到终端。插件复用这份账号连接；不需要把网站密码、PAI Token 或 DeepSeek API Key 发给模型。DeepSeek 模型本身仍由你现有的 Harness 配置决定，本插件不替换模型、不改账号预算。

### 2. 将插件安装进你使用的 profile

例如你使用网页版的 `web` profile：

```sh
dsh plugin --profile web add github:Open-Glyph/OpenGlyph-DeepSeek-Harness#v0.1.0
dsh web
```

使用其他 profile 时，把两处 `web` 换为实际 profile 名称，例如 `tui`。Git 安装直接使用仓库内的 ESM JavaScript，不需要构建脚本、`prepare` 或允许安装时执行额外程序，也不下载模型、权重或整套图库。更严格的固定方式是把 `#v0.1.0` 换成你审查过的 commit SHA。

安装前后都不会自动修改网站、PAI 配置或原有的三个通用 skills。本插件可以与通用 skills 共存；原来的 IDS/structure 造字方法仍保留，优先使用能导出 LaTeX 项目的可编辑模板方案。

### 3. 选择工作文件夹

在 Harness 中选择一个专门的本地工作文件夹，把准备处理的 PDF 或图片复制进去。默认只允许上传这个工作文件夹里的文件；这样不会因为模型生成一个路径就把其他位置的文件发往服务端。PDF 页码指**物理页码**，不是书中印刷页码。

## 使用：以下文字发到 DeepSeek 对话框，不是终端

第一次先说：

> 使用 OpenGlyph，先检查连接并告诉我能用哪些古文字工具。

识别并排印一页：

> 请处理工作文件夹中 `清华简.pdf` 的物理第32页。先看原图，用专用检测模型取得字图，再检索生僻隶定字。不要把相似常用字当作原字；找不到完全匹配的字形，就找可编辑底字/部件，检查真实部件编号，用 JSON 修改后调用造字工具。最后交付可复制排印的字体、映射、Word示例和LaTeX包。保留全部原图证据与待人工核定意见，不必处理其他页。

单个新字：

> 请把 `待造字.png` 做成可排印候选字。优先图像模板检索 → 查看实际编号部件 → 修改 JSON → 造字。不要只返回一张图片；请给字体和LaTeX包，并展示与原图的比较。

模型通常会依次使用：

```text
本地文件 → gwz_open → 指定页原图 → gwz_glyph_detect
         → gwz_glyph_template_search → gwz_glyph_template_inspect
         → gwz_glyph_compose → gwz_glyph_verify → gwz_deliver
```

这是按需选择的工作流，不是每个普通摘要都强制跑完所有工具。已有可用原生字体或匹配字形可直接复用。原型字的图形重现与学术隶定是两件事；服务并不承诺自动正确释读所有古文字。

## 图像、结果与人工验收

候选图、原页、部件图和字体预览会下载后注册到 Harness 的持久附件服务，作为**真实图像内容块**送给模型，而不是只返回本地路径或把 base64 塞进文字上下文。图片和候选分批展示，并标记后续偏移；`gwz_evidence` 可继续查看，完整结果保存在 `full_json`。

模型路线须支持图像输入，Harness 也须启用附件服务。如果宿主/模型拒绝图像，插件会保留 `image_failures` 与完整记录；这时不能声称“已经看过”。插件不会凭接口包装给不支持看图的模型增加视觉能力。

中间证据和可恢复任务记录保存在 `work/openglyph/`。只有调用 `gwz_deliver` 后，才把实际生成的字体与文档整理到 `outputs/古文字排印/<名称>/`：

```text
排印字体.otf / 排印字体.ttf
字形码位映射.json / 可复制文字.txt
嵌入字体示例.docx / OpenGlyph-LaTeX排印包.zip
可编辑造字项目.json（服务提供时）
排印与核对说明.txt
```

这些是**可排印候选稿**。`ready` 只表示字体生成成功；几何比较、字形核定、学术释读分别报告。人工没有确认，插件不会伪造确认记录。PUA 码位仅属于随附字体，必须保留字体与映射，不能当作正式 Unicode 身份。

## 任务中断与恢复

接受任务后先保存 `job_id` 与本地凭据，再等待结果。停止本地等待不会自动取消远端任务，不会因为网络问题盲目重新 POST。同一个已知任务可让模型使用：

> 用 gwz_resume 恢复任务 `j……`，不要重新上传或重新提交。

插件不新增页数、字数、上传体积、迭代次数、总处理时长或金额限制。预览分页只是上下文展示方式，完整记录不裁掉。实际模型/宿主的附件能力、CLI 连接和服务端账号权限仍以各自配置为准。

## 高级配置

正常情况下无需配置。确有需要时，在相应 profile 的 `cordis.patch.yml` 中覆盖插件行，例如（覆盖会替换整个 config，请保留自己需要的字段）：

```yaml
- id: openglyph
  config:
    cli: /absolute/path/to/guwenzi-tools
    profile: default
    evidenceDirectory: work/openglyph
    deliverableDirectory: outputs/古文字排印
    imagePageSize: 4
    resultPageSize: 32
    cancelGraceMs: 3000
```

`cli` 是已安装 CLI 的可执行文件，不是 shell 命令。`workspaceRoot` 可显式固定工作根目录；默认采用当前会话工作目录。`additionalInputRoots` 可由用户设置额外允许上传的**物理文件夹**。默认不会读取它们。

`imagePageSize` / `resultPageSize` 只控制一次展示多少条，后续可继续取。`cancelGraceMs` 仅供主动取消后的子进程清理，不是工具执行时限。不要把密钥写进插件 YAML。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run pack:check
```

测试使用真正的 Cordis / DSH 工具注册表与执行流水线，CLI 的网络边界用本地模拟器替代；覆盖上传→取页→检索→检查部件→造字→字体交付、参数约束、取消后按编号恢复、分页、路径隔离与卸载。模拟器中的图片和字体字节只是测试夹具，不是造字效果评测。没有调用付费 DeepSeek/Kimi 模型，**尚不能据此宣称真实模型的造字调用率或识别准确率已经提升了多少**。

所有服务器模型、字库、数据许可与费用仍由 OpenGlyph 服务管理，不随本 MIT 插件重新授权。项目网站：[openglyph.cn](https://openglyph.cn)；排印库：[OpenGlyph-LaTeX](https://github.com/Open-Glyph/OpenGlyph-LaTeX)。
