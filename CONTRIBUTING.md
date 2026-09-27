# 贡献与维护指南

## 推送前必做

```powershell
npm run privacy   # 隐私审计：当前文件 + 全部 git 历史
# 期望输出：隐私审计通过：无密钥 / 无个人路径 / 无专属域名 / 数据目录未被跟踪 ✔
```

## 首次创建并推送云端仓库

1. 打开 <https://github.com/new>：
   - **Repository name**：`whalepal`；
   - **Visibility**：建议先选 **Private**（确认无误后再转公开）；
   - **不要**勾选 Add README / .gitignore / Add license：本地已有，勾选会产生冲突的初始提交。
2. 关联并推送：

   ```powershell
   git remote add origin https://github.com/<你的用户名>/whalepal.git
   git branch -M main
   git push -u origin main
   ```

3. 之后每次推送前跑一遍 `npm run privacy`。

## 生成 README 动图

```powershell
# 1) 采集帧（应用会自动抓取桌宠窗口的连续帧到 data/gif-frames/ 后退出）
$env:WHALEPAL_DEBUG_FRAMES='16'; npm start
# 2) 生成 GIF（可指定 帧目录 / 输出 / 帧间隔ms / 目标宽度）
npm run gif
```

## 打包发布

```powershell
npm run dist   # dist/ 下产出 zip（绿色单文件夹）与 NSIS 安装包
```

## 素材与许可

- 立绘素材来自 dsh-whale-musume（MIT），署名见 [NOTICE](NOTICE)；新增素材请同步更新 NOTICE。
- 新增二进制资产（png/webp/gif）无需额外配置，`.gitattributes` 已声明为 binary。
