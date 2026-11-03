---
name: openglyph-paleography
description: 使用 OpenGlyph 原生工具完成古文字原形、隶定字的查形、结构造字、字体与 LaTeX 排印。用于忠实字形采集或可排印输出，不用于普通摘要或把通用 OCR 当作核定。
---

# 古文字证据与排印

本环境已经把工具注册为 gwz_* 原生调用，不必先自己研究终端命令。用 gwz_catalog 查看某个工具完整输入、输出说明与示例；用 gwz_check 检查用户现有 CLI 登录。

## 文献与字图

用 gwz_open 登记用户指定文件，再取指定物理页的 gwz_page_prepare(detail=image)。默认不做版面模型、不搜索书中其他释文页。用 gwz_glyph_detect 取得灰度原图的检测框、原字裁图和全部候选图页。字形图片的 asset_id、文档 document_id、页码和原像素 bbox 不能互换。

普通解释可以轻量阅读。忠实转写和排印则需要逐个差异字形的实际证据，尤其是用户已经指出选错字的情况。看全部相关候选图页，记录漏检、残片、饰笔；不要把检测结果直接当作 OCR 读法。

## 从图找到能编辑的底字

原字图 → gwz_glyph_template_search → 查看候选图与其 program → gwz_glyph_template_inspect。

检索 whole glyph 是找底字，scope=component 是找部件。inspect 返回真实编号 node、部件图和可供选择的修改建议。修改只针对这些实际编号；根节点和子部件需要逐层展开。不要把 r0 等记录编号猜成某种语义笔画。

需要全图库来源和异体时用 gwz_glyph_search，查看真实候选后再 glyph_select；其绑定和 gwz 身份仍不等于学术释读。没有匹配可以 glyph_register 保存原图，但这一步不会生成字体。

## 从缺字到可打印字体

找到吻合的整字就复用；没有整字就复用相近模板和部件，以返回的 JSON program 调整、替换、插入或删除。glyph_compose 支持 program、原图绑定 proposal_id、glyph，也保留 ids 与 structure，两条路线并行；优先可以导出 LaTeX 项目的模板方案。不要编写 raw KAGE 或把相近常用字当作目标字。

供熟悉 API 的调用者参考，实际可用模板示例：

```json
{"program":{"schema":"guwenzi.template-program.v1","base":"ebag:s030-067","edits":[]}}
```

这段只是复用一个底字。真正遇到新形时，必须先 inspect 并看图，再根据实际 node 和原图确定 edits；不能把这个示例误当作所有新字的答案。更详细的模块与编辑调用见 [结构造字示例](references/composition.md)。

glyph_compose 的 print_font.status=ready 才有可下载字体；把 glyphs[].codepoint 与随附 OTF/TTF、mapping 一起使用。多个单字字体可能各自用 U+E000，不能直接拼接；批量 compose 返回的合并字体才处理了冲突。PUA 是字体局部地址，不是官方身份。不能凭看起来像就填写 unicode_codepoint。

## 核对与交付

将每个原打印字图与实际最终字体码位交给 gwz_glyph_verify；直接检查差分，不用 DINO 分数充当验收。needs_review 时保留可打印候选稿和具体待核说明，交给人确认。输出字体可用不意味着原型字释读或字形准确已经得到确认。

用 gwz_deliver 保存可复制文字、OTF/TTF、码位映射、嵌入字体 Word 与 LaTeX 包。它只整理实际已有的造字结果，不伪造确认记录。中间证据在 work，最终成果在 outputs；不要把几十张中间字图当作交付文件。

gwz_transcribe 只保存已经读出的分段文本。竖排阅读顺序与原形/隶定的逐字对应另用 reading_plan 保存，不能以行数或位置相近取代字形核对。完整候选保存在 full_json；列表或图片有 next_offset 时，用 gwz_evidence 继续看。
