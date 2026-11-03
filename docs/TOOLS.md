# 工具输入、输出与调用参考

由公开工具 Schema 与插件用途说明生成；每次远端执行前还会用实时 Schema 校验。示例中的文字身份说明是占位提示，必须换为工具实际返回的 ID，不能逐字照抄。

所有工具名为 `gwz_` + 下列服务端名称。规范返回保留 `status`、`job_id`、`full_json`、`result`，另有紧凑 `summary`、图像附件、分页与 `next_tools`。原始记录不因当前预览分页而丢失。

## gwz_document_open：登记文献

登记已上传的 PDF、图像或 Office 文件，取得 document_id 和页数；本工具不会识字。若手里是本地文件路径，先用 gwz_open 或 gwz_upload，不要把路径填进 input_key。

返回：document_id、source_sha256、pages；这是文档身份和范围，不是释文。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `input_key` | string | 是 | Relative to the configured inputs/ directory |

调用参数示例：

```json
{
  "input_key": "从 gwz_upload 返回的 input_key"
}
```

后续工具：`gwz_page_prepare`。

## gwz_page_prepare：取一页原始证据

取用户指定物理页的原图及可用的原生文本。默认仅 detail=image，不做布局、不批量切字、不自动找其他释文页。内置原生文本是来源材料，不是经核定的隶定。

返回：document_id、page、page_asset.asset_id、原始尺寸、坐标空间、原生文本证据；图像会直接展示。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `document_id` | string | 是 |  |
| `page` | integer | 是 |  |
| `mode` | string | 否 | "auto" |
| `dpi` | integer | 否 | 288 |
| `detail` | string | 否 | image（插件默认） |

调用参数示例：

```json
{
  "document_id": "使用登记结果中的 document_id",
  "page": 32,
  "detail": "image"
}
```

后续工具：`gwz_glyph_detect`、`gwz_reading_plan`。

## gwz_asset_import：登记已上传图像

把上传返回的 input_key 登记为原始图像 asset_id。不接受本地文件路径、URL、裁切预览坐标。

返回：asset_id、sha256、size_px；只证明图像字节身份，不证明字的读法。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `input_key` | string | 是 | Relative to the configured inputs/ directory |

调用参数示例：

```json
{
  "input_key": "从 gwz_upload 返回的 input_key"
}
```

后续工具：`gwz_glyph_detect`、`gwz_glyph_search`。

## gwz_crop：按已核定原图框裁切

执行已经精确确定的原像素半开框 [left,top,right,bottom]，支持 items 批量。优先采用 gwz_glyph_detect 的框；不要自己看缩略图估算坐标。粗框定位应交给检测器，而不是此工具。

返回：原像素裁图 asset、父图 asset_id、bbox_px、来源记录；不会 OCR。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string / null | 否 | null |
| `bbox_px` | array / null | 否 | null |
| `items` | array / null | 否 | null |

调用参数示例：

```json
{
  "asset_id": "使用原图的 asset_id",
  "bbox_px": [
    100,
    200,
    160,
    280
  ]
}
```

后续工具：`gwz_glyph_template_search`、`gwz_glyph_search`。

## gwz_glyph_detect：专用模型框字

用常驻小模型对灰度原图定位字形，不依赖大模型手写 bbox。整页可只给 asset_id；粗框会默认向周围扩大 5 倍。直接返回原字裁图与全部编号候选，不能把检测框当成识字结果，也不能默默忽略漏检。

返回：candidates[].candidate_id、bbox_px、asset.asset_id，source_size_px、全部 contact_sheets、边界诊断；候选编号不是阅读顺序。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string | 是 |  |
| `bbox_px` | array / null | 否 | null；Optional rough original-pixel bbox; expanded once around its center. Omit for full image. |
| `expansion` | number | 否 | 5 |
| `confidence` | number | 否 | 0.25 |
| `imgsz` | integer | 否 | 640 |

调用参数示例：

```json
{
  "asset_id": "使用 page_asset.asset_id",
  "confidence": 0.25
}
```

后续工具：`gwz_glyph_template_search`、`gwz_glyph_search`、`gwz_reading_plan`。

## gwz_split_line：规则行列的投影分割

仅对已经定位、方向明确的规则打印体行列提出字位；竖排用 vertical-ttb。不把投影当作竹简、甲骨、拓片的可靠单字边界。

返回：line_id、原行图、slots 的原像素框和各字图。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string | 是 |  |
| `direction` | string | 否 | "horizontal-ltr" |

调用参数示例：

```json
{
  "asset_id": "已经定位的打印体列 asset_id",
  "direction": "vertical-ttb"
}
```

后续工具：`gwz_glyph_template_search`、`gwz_reading_plan`。

## gwz_reading_plan：保存阅读顺序与逐字对应

记录分区、列序、字序，以及原形图与隶定打印字的对应。使用既有检测结果和实际证据；保留缺字、残片、重文号、空侧和一对多关系，不能因数量相等就声称对应。

返回：带版本的阅读计划、分区、单位和 alignments；不会识别或核定字义。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string | 是 |  |
| `writing_mode` | string | 否 | "vertical-rl" |
| `regions` | array | 是 |  |
| `section_order` | array / null | 否 | null |
| `alignments` | array | 否 |  |

调用参数示例：

```json
{
  "asset_id": "原图 asset_id",
  "writing_mode": "vertical-rl",
  "regions": [
    {
      "id": "col-1",
      "bbox_px": [
        100,
        20,
        180,
        700
      ],
      "units": []
    }
  ]
}
```

后续工具：`gwz_transcribe`。

## gwz_glyph_verify：原图与最终字体直接比较

将每个原打印体字图与最终字体的明确码位直接渲染比较。用于排印验收，不用 DINO 相似度代替。needs_review 时保留可打印稿并向人展示差异，不能假称通过，也不能无限重试。

返回：逐项 pass/needs_review、原图/字体渲染/差分图、缺失和多出部分的诊断；这是几何比较，不是学术释读确认。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `items` | array | 是 |  |

调用参数示例：

```json
{
  "items": [
    {
      "source_asset_id": "原字图 asset_id",
      "font_asset_id": "最终合并字体 asset_id",
      "codepoint": "U+E000"
    }
  ]
}
```

后续工具：`gwz_glyph_template_inspect`、`gwz_glyph_compose`、`gwz_deliver`。

## gwz_glyph_search：DINO 全图库字形检索

对生僻、争议或不熟悉字形检索相似原图。支持 asset_id 或 asset_ids。适合查来源和异体；若目标是可编辑底字/部件，优先用 gwz_glyph_template_search。相似度不等于识字概率。

返回：search_id、candidates[].candidate_id、候选 asset_id 和图像、score；标签未揭示、身份未确认。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string / null | 否 | null |
| `asset_ids` | array / null | 否 | null |
| `top_k` | integer | 否 | 8 |
| `expand_search_id` | string / null | 否 | null |

调用参数示例：

```json
{
  "asset_id": "单字原图 asset_id",
  "top_k": 8
}
```

后续工具：`gwz_glyph_select`、`gwz_glyph_template_search`。

## gwz_glyph_select：保存本次检索候选选择

看过候选图以后，用同一 search_id 下的 candidate_id 保存选择。不从编号或得分猜字，不跨搜索复制候选编号。

返回：binding_id、永久 gwz 身份和来源信息；选择仍未经过图形或学术核定。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `search_id` | string | 是 |  |
| `candidate_id` | string | 是 |  |

调用参数示例：

```json
{
  "search_id": "检索返回的 search_id",
  "candidate_id": "c1"
}
```

后续工具：`gwz_glyph_lookup`、`gwz_glyph_resolve`、`gwz_transcribe`。

## gwz_glyph_resolve：查看永久字形身份及来源

用已有 gwz 代码取回字形、来源别名与映射证据；来源别名不是确定读法。

返回：原图、主来源记录、别名、字体/码位信息与其未核定状态。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `code` | string | 是 |  |

调用参数示例：

```json
{
  "code": "使用工具实际返回的 gwz 代码"
}
```

后续工具：`gwz_glyph_lookup`、`gwz_glyph_compose`。

## gwz_glyph_register：保存没有匹配的原字图

为原字图登记稳定 gwz:sha256 身份，以便比较和追踪。它不是造字、不会生成可打字字体；需要排印时继续走模板检索和 glyph_compose。

返回：基于原始字节的稳定 gwz 代码和未释读状态。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string | 是 |  |

调用参数示例：

```json
{
  "asset_id": "未找到匹配的原字图 asset_id"
}
```

后续工具：`gwz_glyph_template_search`、`gwz_glyph_compose`。

## gwz_transcribe：保存已经阅读的释文

仅保存调用者已经读出和校对的 text/binding_id/glyph_code 等分段，完全不会调用 OCR 或识别模型。不要指望调用此工具能自动识字；不熟悉字形须先查字、选模板或造字。

返回：持久化释文版本、原文档/页/块引用、文字与字形引用；保存成功不等于识字正确。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `document_id` | string | 是 |  |
| `page` | integer | 是 |  |
| `block_id` | string | 是 |  |
| `parts` | array | 是 |  |
| `author` | string | 否 | "external_multimodal_model" |

调用参数示例：

```json
{
  "document_id": "已登记文档",
  "page": 32,
  "block_id": "页面返回的 block_id",
  "parts": [
    {
      "text": "已经核对的原文"
    }
  ]
}
```

后续工具：`gwz_document_result`、`gwz_glyph_verify`。

## gwz_document_result：取回文献阅读结果

按阅读顺序分页取回保存的块、文字、图表和未处理状态；有 next_offset 时仍有后续，不得把当前一页当成全部。

返回：blocks、total_blocks、next_offset、未完成计数；已保存释文不自动获得核定身份。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `document_id` | string | 是 |  |
| `offset` | integer | 否 | 0 |
| `limit` | integer | 否 | 50 |

调用参数示例：

```json
{
  "document_id": "已登记文档",
  "offset": 0,
  "limit": 50
}
```

后续工具：`gwz_glyph_verify`、`gwz_deliver`。

## gwz_layout_analyze：可选版面建议（非默认流程）

仅在用户确实需要版面建议时使用。不会 OCR，不能替代单字检测；普通取页与字形采集不自动运行版面模型，也不凭版面类别寻找书中其他释文页。

返回：未核定的区域、可选行/字位及覆盖图。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string | 是 |  |
| `analysis_mode` | string | 否 | "regions" |
| `imgsz` | integer | 否 | 1024 |
| `writing_mode` | string | 否 | "horizontal-tb" |

调用参数示例：

```json
{
  "asset_id": "原页 asset_id",
  "analysis_mode": "regions",
  "writing_mode": "vertical-rl"
}
```

后续工具：`gwz_glyph_detect`、`gwz_reading_plan`。

## gwz_glyph_lookup：按编号查可排印底字或部件

查 Unicode、GlyphWiki ASCII 名称、返回的 glyph_ref、已选择的 gwz 代码或 IDS，显示真实字形与异体。mode=parts 展示可复用部件和布局；不知道如何键入生僻字时，用图像模板检索返回的程序/编号，不要求先打出该汉字。

返回：glyph_ref、可用变体、真实预览、部件/模板、分页 next_offset。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `query` | string | 是 | Unicode character, IDS, GlyphWiki name, returned gwk: reference, or public gwz code selected from DINO search; never stroke code. |
| `mode` | string | 否 | "variants" |
| `offset` | integer | 否 | 0 |
| `limit` | integer | 否 | 8；Preview page size, not a total candidate quota; follow next_offset. |

调用参数示例：

```json
{
  "query": "u81e4",
  "mode": "parts"
}
```

后续工具：`gwz_glyph_template_inspect`、`gwz_glyph_compose`。

## gwz_glyph_template_search：按图寻找可编辑底字和部件

从原字图检索可排印的 GlyphWiki 底字与部件，直接返回可回放 JSON program。造新字先用本工具找最接近底字；scope=component 可找部件。不用先输入打不出的汉字，不把相似候选直接当成正确字。

返回：候选的 glyph_ref/glyph_name、program、kind、真实预览和分页；候选身份未核定。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `asset_id` | string / null | 否 | null |
| `asset_ids` | array / null | 否 | null |
| `scope` | string | 否 | "all" |
| `top_k` | integer | 否 | 8 |
| `offset` | integer | 否 | 0 |
| `rerank` | boolean | 否 | true |

调用参数示例：

```json
{
  "asset_id": "待排印单字的原图 asset_id",
  "scope": "all",
  "top_k": 8
}
```

后续工具：`gwz_glyph_template_inspect`、`gwz_glyph_compose`。

## gwz_glyph_template_inspect：展开并查看模板编号部件

展开实际返回的 program，查看 root 或某个真实 node 的编号与预览。按这些编号替换部件、增饰笔、删记录、移动或缩放；不要猜编号、把记录号当汉字笔画语义，或编底层 KAGE。hint_asset_id 可给出原图绑定的修改建议。

返回：实际 program、nodes[].node、编号部件图、diagnostics/proposals、来源绑定的 proposal_id；建议不会自动应用。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `program` | object | 是 | Replayable candidate program or edited program. No raw KAGE. |
| `node` | string | 否 | "root" |
| `hint_asset_id` | string / null | 否 | null；Original query for side-by-side evidence and non-binding node-level edit proposals. |

调用参数示例：

```json
{
  "program": {
    "schema": "guwenzi.template-program.v1",
    "base": "ebag:s030-067",
    "edits": []
  },
  "node": "root"
}
```

后续工具：`gwz_glyph_compose`、`gwz_glyph_template_inspect`。

## gwz_glyph_compose：造新字并生成可复制排印字体

需要输出可打字、可排印的生僻隶定字或新字时调用。本工具不是贴图片：服务端生成 SVG/PNG 和 OTF/TTF、码位映射、可复制文本、嵌入字体 Word、LaTeX 包。优先使用 template_search→inspect 返回的 program/proposal；找不到全字就改部件和结构。旧 IDS/structure 方案保留并行。不可用相似常用字顶替，不写原始 KAGE。

返回：gwz_code、真实预览、print_font.status、otf_asset/ttf_asset/mapping_asset/text_asset/word_sample_asset、glyphs 和 LaTeX 包。ready 只证明字体可下载，不证明与原图相同。批量采用合并字体，不能拼接多个单字字体的 U+E000。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|
| `proposal_id` | string / null | 否 | null |
| `glyph` | string / null | 否 | null |
| `ids` | string / null | 否 | null |
| `structure` | object / null | 否 | null |
| `program` | object / null | 否 | null |
| `fit_nodes` | array / null | 否 | null |
| `hint_asset_id` | string / null | 否 | null |
| `items` | array / null | 否 | null |
| `unicode_codepoint` | integer / string / null | 否 | null |

调用参数示例：

```json
{
  "program": {
    "schema": "guwenzi.template-program.v1",
    "base": "ebag:s030-067",
    "edits": []
  }
}
```

后续工具：`gwz_glyph_verify`、`gwz_deliver`。

## gwz_doctor：核查工具资源

核查并缓存服务端模型、索引和字库校验和，不识字。普通连通性请用 gwz_check，避免每次任务重跑全资源检查。

返回：协议、资源存在和校验状态；不运行大语言模型。

| 参数 | 类型 | 必填 | 默认/说明 |
|---|---|---|---|

调用参数示例：

```json
{}
```

后续工具：`gwz_open`、`gwz_page_prepare`。
