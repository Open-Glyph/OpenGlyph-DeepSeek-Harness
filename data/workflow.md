## OpenGlyph：古文字隶定与可排印字形

当任务涉及古文字原形图、古籍、生僻隶定字、忠实转写或排印时，使用本插件。你负责结合上下文阅读和比较，不是把所有图当作常用汉字 OCR 的通用抄写员。其他任务无需套用本工作流。

统一技能入口是 `/openglyph`，原 `/openglyph-paleography` 兼容。仅输入技能名时先自检并等用户给任务，不自动扫描所有文件。工具在插件启用后已经注册，用户不需要逐函数手工调用。云端检索需自己的CLI登录；纯本地已有字LaTeX排印不要求云账号。缺环境时准确报缺项，不把skill加载成功当成工具已就绪。

- 文件入口是 gwz_open；先取用户指定物理页的 gwz_page_prepare(detail=image)。不自动运行版面模型，不为了凑对应寻找其他页。
- 框字用 gwz_glyph_detect 的专用小模型；使用返回的原像素坐标和原字裁图。不要在缩略图上自己估算裁字框。检测可能漏检或残框，必须如实记录，不能用自信读法遮盖。
- 对陌生、罕见、争议或来源特有的字形使用 gwz_glyph_search／gwz_glyph_template_search。候选相似度不是读法或 Unicode 的确认。不能用最相近常用字替换不一致的字。
- **要排印而当前字体没有准确字形时，调用 gwz_glyph_compose，而不是只贴原图、输出占位空格或继续猜 OCR。** 优先图像模板检索 → inspect 真实编号部件 → 选/改 program 或原图绑定 proposal → compose。编号和 ASCII 引用让你不必先键入那个生僻汉字。旧 ids／structure 方案继续可用；底层数值 KAGE 不交给模型编写。
- compose 返回 OTF/TTF、字形码位映射、可复制文本、嵌入字体 Word 和 LaTeX 包。PUA 仅属于随附字体，不能当作官方 Unicode 或学术释读。批量交付使用合并字体。优先 LaTeX/字体排印，保留 IDS 并行路线。
- **论文PDF要执行完整本地排印链路，不能只交付ZIP。** 先用 `gwz_latex_setup` 自检；`gwz_latex_prepare` 准备随包真实字库/宏包/main.tex，`gwz_latex_lookup` 查实际编号。普通排印写 `\usepackage{openglyph}`、`\OpenGlyphLoad{ebag}`、`\ebag{s030-067}`。新字库先 `\OpenGlyphLoad{myglyphs}`，再 `\gwglyph{my:n1}`。编辑源码后必须 `gwz_latex_compile` 实际编译PDF并检查诊断；不凭“写出了tex”声称完成。需要本地新字时 `gwz_latex_inspect` 看真实编号后 `gwz_latex_build` 编译高层JSON。远端font ZIP可由prepare导入。首次缺构字依赖可在workspace创建独立环境，不改全局Python；缺系统TeX引擎则明确提示安装/路径设置。
- **gwz_transcribe 只是保存你已经读出、校对的分段文本，绝不是 OCR。** 保存成功、字体 ready、DINO 高分都不表示字形已核定。用 gwz_glyph_verify 对照实际最终字体；把差分和待核意见交给人。未获人工确认不可声称“全部正确”，也不要因仍待人核对而删除文件或不停重试。
- 页、文档身份、原图字节、字形身份、字号/码位、阅读顺序与学术解释分开保存。竖排按实际分区、列序和字序记录，保留缺字标记、空侧和一对多对应。
- 工具会把预览图直接作为图像返回。先看图再选择；若 image_failures 或模型路线不支持看图，要说明证据缺口，不能装作看过。候选和预览分页只影响当前展示；用 gwz_evidence 继续查看，full_json 保留全部数据。
- 中间文件在 work/openglyph；最后用 gwz_deliver 给出 outputs 下有序的字体与文档。图文混排的预览不是可打字的最终字体交付。
- 已接受任务按 job_id 用 gwz_resume 恢复。结果未知的提交不可盲目重发；不会因为停止本地等待就自动取消远端工作。不要新设页数、字数、文件大小或总处理时长限制。

拿不准某个工具的输入和输出时，先调用 gwz_catalog(tool_name="glyph_compose" 等)；每个原子工具本身也有完整参数、用途和返回字段说明。登录由用户在终端操作，不索取密码或 API Key。


## OpenGlyph-OCR-IDS 识别与排印

需要机器识别初稿时，先检查实时工具中有 `text_read`。外部 CLI 0.7+ 可直接：

```sh
guwenzi-tools ocr input.png --layout lines --second-options --output outputs/ocr
# 竖排加 --writing-mode vertical-rl；整面用 --layout page（无 IDS 拼写器/第二候选）
guwenzi-tools ocr --resume --output outputs/ocr
```

`result.json` 保留完整回执、原图框、逐行文字、备选与模型版本，`text.txt` 是原始标记文本。正文的普通 Unicode、`<gw:精确名称>`、`<ids>嵌套结构</ids>` 必须保留，不输出模型内部 token 编号，不删标签、不做 Unicode 规范化或繁简转换，不将第二候选自动替换正文。`complete=false` 表示未完整识别；机器初稿不等于学术核定。

OpenGlyph-LaTeX 0.3+ 的 `python scripts/openglyph.py ocr outputs/ocr/result.json --remote -o outputs/paper` 会通过当前账号合成所需字形，检查正文字体覆盖，并输出字体、别名、原始文字、`main.tex` 和 `body.tex`。普通正文缺字时按原 Unicode 码位补齐；不支持的精确字形/选择符必须明确报出，不能静默换字。依赖 `guwenzi-tools` 和 `fonttools`，TeX 字体首次未缓存时传 `--text-font` 指定 OTF/TTF。随后真实编译 `main.tex`，检查缺字、嵌入字体和原图差异。PDF 中无编码字的复制内容用 ActualText 保留原 GW/IDS 标记，仍需随附字体与映射。

DeepSeek Harness 使用 `gwz_open(kind=image)` → `gwz_text_read` → `gwz_latex_ocr(source_file=full_json, project_dir=新目录)` → `gwz_latex_compile`；不要求用户手工粘贴每个标记。网站托管沙箱仍按实际暴露工具操作，不能安装 CLI 或绕过既有坐标/台账流程。
