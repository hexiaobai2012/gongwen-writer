# Contributing

感谢你改进 `gongwen-writer`。这是一个面向 DeepSeek Harness 的中文公文写作插件，涉及格式、政治性表述和本地文件，提交前请特别留意准确性、隐私和可回滚性。

## 提交 Issue

请说明：

- DSH 版本、操作系统、Node 版本；
- 复现步骤；
- 期望结果和实际结果；
- 相关错误日志（先删除密钥、内网地址、真实公文内容和个人信息）。

## 开发环境

```bash
git clone https://github.com/hexiaobai2012/gongwen-writer.git
cd gongwen-writer
node --version          # >= 22
python -m py_compile python/render_docx.py python/extract_docx.py
```

本地安装到 DSH：

```bash
dsh plugin --profile <profile> add ./gongwen-writer
```

或在插件市场安装 npm 版本：

```bash
dsh plugin --profile <profile> add gongwen-writer
```

## 代码约定

- Host 工具注册集中在 `index.js`；格式和 Word 渲染在 `python/render_docx.py`。
- 任何正文变化都要调用 `refreshPreview`，保证《题目_打磨版.docx》实时更新。
- 新增格式规则时，同时更新 `check` 和 `README.md`。
- 涉及政治性表述时，只使用官方来源正文；不要引入搜索摘要作为证据。
- 不在仓库中提交生成的 `.docx`、`.gongwen-writer/`、真实公文、密钥或浏览器缓存。
- 不把 `gongwen-skill` 加回来作为依赖；本插件自带渲染器。

## Pull Request

1. 从 `main` 创建分支；
2. 保持改动聚焦，一个 PR 只做一件事；
3. 写清楚改了什么、为什么改、如何验证；
4. 运行语法检查；
5. 如果改了格式或事实核查，附上脱敏后的验证结果。

```bash
for f in index.js client.js lib/*.js; do node --check "$f" || exit 1; done
python -m py_compile python/render_docx.py python/extract_docx.py
rm -rf python/__pycache__
```

## 安全

发现凭据泄露、命令注入、越权读取本地文件、微信公众号白名单绕过等问题，请不要公开 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

提交代码即表示同意以 MIT License 贡献。
