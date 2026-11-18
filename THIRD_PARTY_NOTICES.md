# 第三方组件说明

本插件不打包第三方 Python 包，也不复制 gongwen-skill 的代码。

运行时依赖：

| 组件 | 来源 | 用途 |
|---|---|---|
| Python 3.10+ | DeepSeek Harness 自带运行时（或用户配置的 `GONGWEN_WRITER_PYTHON`） | 执行内置的 `python/render_docx.py` |
| python-docx | [python-openxml/python-docx](https://github.com/python-openxml/python-docx)，MIT，Copyright (c) 2013 Steve Canny | 生成、检查 `.docx` |
| Google Chrome | 用户本机安装，Google 专有软件 | 仅在用户明确要求并确认后，读取微信公众号等普通请求打不开的链接；读完自动关闭 |

gongwen-skill 不再参与默认导出流程；插件内的 GB/T 9704 渲染与检查代码位于 `python/render_docx.py`，为本插件自有实现。
