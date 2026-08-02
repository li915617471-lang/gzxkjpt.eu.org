# 免费上线最后步骤

项目代码、自动部署、域名文件、云端接口和检查流程均已准备完成。下面步骤涉及你的外部账号，不能由本地代码代替。

## 1. 发布到 GitHub Pages

本机没有安装 GitHub CLI，建议使用 GitHub Desktop：

1. 登录 GitHub，新建一个空的公开仓库，不要添加 README 或模板；
2. 在 GitHub Desktop 选择 `File -> Add local repository`；
3. 选择桌面文件夹 `信息分享平台`；
4. 点击 `Publish repository`，确认默认分支为 `main`；
5. 打开仓库 `Settings -> Pages`；
6. 在 `Build and deployment` 中选择 `GitHub Actions`；
7. 打开仓库的 `Actions`，确认 `Deploy GitHub Pages` 运行成功。

每次推送到 `main` 后，工作流会自动：

- 生成站点地图、RSS、JSON Feed 和 PWA 图标；
- 检查内容结构、来源覆盖、离线缓存和域名配置；
- 生成不含数据库脚本和开发文件的 `_site` 部署包；
- 发布到 GitHub Pages。

## 2. 绑定 gzxkjpt.eu.org

等待 EU.org 审批并确认域名已委派到 deSEC 后，在 deSEC 的 `gzxkjpt.eu.org` 区域添加 GitHub Pages 顶级域名记录。

IPv4 `A` 记录，名称使用区域根节点（通常填写 `@` 或留空）：

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

IPv6 `AAAA` 记录：

```text
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

不要在区域根节点添加 CNAME。项目中的 `CNAME` 文件已经设置为 `gzxkjpt.eu.org`。

DNS 生效后回到 GitHub `Settings -> Pages`：

1. Custom domain 填写 `gzxkjpt.eu.org`；
2. 等待 DNS check successful；
3. 勾选 `Enforce HTTPS`。

## 3. 启用 Supabase 云端后台

按 `SUPABASE_SETUP.md` 执行。最后只需在后台填写：

- Project URL；
- 公开的 anon key 或 publishable key；
- 内容空间保持 `main`；
- 存储桶保持 `media`。

不要把数据库密码、`service_role` 或 `sb_secret_*` key 填进网页。

完成后，后台内容、访客纠错和资料上传才能跨设备同步。未配置前仍是当前浏览器本地模式。

## 4. 自动更新

仓库发布后，`Smart industry update` 每天北京时间 08:17 左右自动运行。选择非整点时间可降低 GitHub 调度拥堵，实际启动可能有少量延迟。当前覆盖六个板块、8 个公开来源；所有抓取结果只进入草稿或待审核状态。

后台操作顺序：

1. 打开“智能更新”；
2. 点击“同步最新自动草稿”；
3. 打开“内容管理”核对标题、摘要、分类和原始来源；
4. 质量门槛通过后发布；
5. 云端模式下点击“保存到云端”。
