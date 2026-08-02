# Supabase 云端后台配置顺序

完成下面步骤后，后台将从“本地模式”切换为“云端模式”。

## 1. 创建免费 Supabase 项目

1. 打开 https://supabase.com/ 并注册；
2. 点击 `New project`；
3. 设置项目名称、数据库密码和区域；
4. 等待项目创建完成。

数据库密码只用于管理数据库，不要写进网页代码。

## 2. 初始化数据库和文件存储

1. 打开 Supabase 项目的 `SQL Editor`；
2. 新建查询；
3. 打开本项目的 `supabase-schema.sql`；
4. 将全部 SQL 粘贴到 SQL Editor；
5. 点击 `Run`。

这一步会创建：

- `site_settings`：站点文字、主题和首页聚合配置；
- `categories`：板块名称、颜色、图标、关键词和排序；
- `articles`：文章正文、来源、状态、定时发布时间和标签；
- `content_reports`：访客纠错、版权与下架请求及其处理状态；
- `site_content`：仅保留作旧版数据自动迁移和兼容；
- `admin_users`：管理员白名单；
- `media`：公开图片/资料存储桶；
- `save_site_snapshot`：一次性同步三类数据，避免部分保存；
- RLS 权限：访客只能读取公开内容和提交反馈，不能读取他人反馈；管理员登录后可管理全部内容和反馈。

如果之前已经使用旧版 `site_content`，再次执行新版 SQL 会自动迁移现有站点、板块和文章。迁移完成后，旧表不再向访客公开，草稿不会通过旧 JSON 泄露。

已经执行过旧版 SQL 的项目也需要重新运行一次当前文件，用于添加 `content_reports` 反馈队列；脚本可重复执行，不会清空现有内容。

## 3. 创建管理员账号

1. 打开 `Authentication` -> `Users`；
2. 点击 `Add user`；
3. 填写你的管理员邮箱和密码；
4. 回到 `SQL Editor`；
5. 执行下面 SQL，并替换邮箱：

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = '你的管理员邮箱'
on conflict (user_id) do nothing;
```

## 4. 填写网页云端配置

1. 打开平台后台的“发布上线”；
2. 在“Supabase 云端连接”中填写 `Project URL`；
3. 填写公开的 `Publishable key` 或旧版 `anon key`；
4. 保持内容空间为 `main`、存储桶为 `media`；
5. 点击“测试连接”，确认数据库结构已就绪；
6. 勾选“启用云端模式”并保存。

这些信息位于 Supabase `Project Settings` -> `API`。配置只保存在当前浏览器，不会写入项目源码。

`anon key` 可以出现在网页代码中，真正的写入安全由 `supabase-schema.sql` 的 RLS 权限控制。不要把 `service_role` key 写到网页中。

## 5. 第一次发布云端内容

1. 双击桌面的“信息分享平台”快捷方式并进入后台；
2. 登录管理员账号；
3. 后台会先显示本地 `data/content.json`；
4. 点击“保存到云端”；
5. 前台刷新后会优先读取云端内容。

云端保存后可在 `Table Editor` 中分别查看 `site_settings`、`categories` 和 `articles`。不要直接修改表结构；日常内容操作仍在平台后台完成。

## 6. 自动更新

上传到 GitHub 后，`.github/workflows/smart-update.yml` 会每天北京时间 08:17 左右更新 `data/intelligence-draft.json`。非整点调度可降低 GitHub 任务拥堵，实际启动可能有少量延迟。

后台点击“同步最新自动草稿”，审核、修改后再保存到云端。默认不自动公开未经审核的内容。

### 自动写入 Supabase 待审核区

项目还包含 `scripts/sync_supabase_drafts.py`。配置一次 GitHub 加密密钥后，每日任务会把新采集结果直接追加到 Supabase 的草稿/待审核区：

1. 在 Supabase 项目打开 `Project Settings` -> `API`；
2. 找到服务器端 `service_role` key（或新版 Secret key）；
3. 打开 GitHub 仓库 `Settings` -> `Secrets and variables` -> `Actions`；
4. 新建 Repository secret，名称必须是 `SUPABASE_SERVICE_ROLE_KEY`；
5. 密钥只粘贴到 GitHub 加密输入框，不要发到聊天、写入源码或截图公开；
6. 打开仓库 `Actions` -> `Smart industry update` -> `Run workflow` 做首次验证。

自动入库有四层保护：只允许 `draft` / `review` 状态、相同来源链接和标题自动去重、不会更新已有文章、不会自动公开。没有配置密钥时，采集文件仍会正常更新，但云端同步步骤会明确显示为已跳过。
