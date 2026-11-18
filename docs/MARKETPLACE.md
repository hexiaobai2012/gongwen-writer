# 发布到 DeepSeek Harness 插件市场

DSH 插件市场 `awesome-dsh-plugin` 使用「一个插件一个 YAML 文件」的投稿方式。本仓库已经准备好条目模板，提交时复制到该仓库：

```text
data/plugins/hexiaobai2012__gongwen-writer.yml
```

内容：

```yaml
url: https://github.com/hexiaobai2012/gongwen-writer
name: hexiaobai2012/gongwen-writer
category: docs
description:
  en: "Chinese official-document writing assistant for DeepSeek Harness: first-turn research and three outline candidates, GB/T 9704 Word rendering, live polished DOCX, paragraph and sentence review, official-source fact checking, official WeChat accounts, and project memory."
  zh: "面向 DeepSeek Harness 的中文公文写作助手：首轮检索并给出三个框架候选，按 GB/T 9704 生成 Word，实时《题目_打磨版.docx》，逐段逐句推敲，官方来源事实核查、官方微信公众号与项目记忆。"
icon: https://raw.githubusercontent.com/hexiaobai2012/gongwen-writer/main/assets/icon-180.png
```

## 提交前检查

1. GitHub 仓库根目录有 `package.json`，且声明 `dsh.bundle.patch`。
2. npm 包可安装：`dsh plugin --profile <profile> add gongwen-writer`。
3. 仓库默认分支为 `main`，README、LICENSE、icon 可公开访问。
4. `assets/icon-180.png` 可访问（市场卡片使用 GitHub 托管的 PNG）。
5. 不提交 `.gongwen-writer/`、生成的 `.docx`、真实公文、密钥。

## 提 PR

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`；
2. 新建 `data/plugins/hexiaobai2012__gongwen-writer.yml`；
3. 只提交这一个文件，不要手工改生成的 README；
4. PR 标题示例：`Add gongwen-writer`；
5. 等待维护者审核。

分类 `docs` 表示文档处理类；如果维护者建议改成 `usage` 或 `workflow`，按维护者意见调整即可。

## npm 发布

```bash
npm login
npm publish
```

发布后可在 DSH 中安装：

```bash
dsh plugin --profile <profile> add gongwen-writer
```

也可以用 GitHub 源码安装：

```bash
dsh plugin --profile <profile> add https://github.com/hexiaobai2012/gongwen-writer
```

## 版本

第一次公开发布建议保留 `2.4.0`；后续按 `CHANGELOG.md` 更新版本。
