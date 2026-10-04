# 智能复读机

手机复读软件（Web + Android APK）：导入视频/音频后自动智能断句，支持 AB 循环复读、逐句跳转、变速播放、录音跟读、语音识别字幕。所有数据处理均在本地完成。

## 功能一览

- **智能断句**：解码音轨、检测语音停顿自动切句（灵敏度可调），也支持手动断句、字幕断句
- **AB 复读**：点句即循环，A/B 左右微调（步长可选，长按连调），复读 1/2/3/5/8/10/无限 次或不复读
- **逐句跳转**：上一句 / 下一句 / 句子列表点选，复读完可自动跳下一句
- **变速播放**：0.5x – 2.0x 十二档滚轮选择
- **语音识别字幕**：内置 Whisper 模型（本地运行，无需联网），一键生成带时间轴字幕，也支持导入 SRT/VTT
- **历史记录**：导入过的文件自动保存在本机（IndexedDB），随时切换
- **应用内热更新**：APK 内置热更新引擎，新版本网页包发布后会自动提示下载更新
- **可拖动进度条 + 波形**：点击/拖动定位，波形上直观显示断句点、AB 区间、当前句

## 技术栈

React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui ｜ Capacitor 8（Android 封装）｜ @xenova/transformers（浏览器本地 Whisper 语音识别）｜ @capgo/capacitor-updater（热更新）

## 本地开发

```bash
npm install
npm run dev        # 开发预览 http://localhost:3000
npm run build      # 生产构建到 dist/
```

## 构建 Android APK

需要 JDK 21 与 Android SDK（platform-34、build-tools 34.0.0）：

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug   # Windows 用 gradlew.bat
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

## 发布更新（网页 + 热更新）

1. 修改代码后，把 `package.json` 的 `version` 和 `src/config.ts` 的 `APP_VERSION` 同时加 1（两者必须一致）
2. `git push` 到 main 分支
3. GitHub Actions 自动完成：构建 → 发布到 GitHub Pages（可直接在线使用）→ 生成热更新包（`latest.json` + `update.zip`）
4. 已安装 APK 的用户下次打开应用即自动检测并后台下载更新

## 首次部署清单（只做一次）

1. 在 GitHub 新建空仓库（建议名 `smart-repeater`），不要勾选 README
2. 本地执行：`git remote add origin https://github.com/<你的用户名>/smart-repeater.git && git push -u origin main`
3. 仓库 Settings → Pages → Source 选 **GitHub Actions**
4. 把 `src/config.ts` 里的 `UPDATE_BASE` 改成 `https://<你的用户名>.github.io/smart-repeater/`，再提交一次 push
5. 重新构建 APK 分发给用户；以后更新走「发布更新」流程即可，无需再发安装包

## 目录说明

```
src/
  pages/Home.tsx        主界面（播放器 + 全部交互）
  components/           波形 / 进度条 / 滚轮选择器等
  lib/audio.ts          智能断句算法（静音检测）
  lib/asr.ts + workers/ 语音识别（Whisper Worker）
  lib/history.ts        历史记录（IndexedDB）
  lib/updater.ts        热更新检查
  config.ts             版本号与热更新地址（发布前必看）
public/models/          内置 Whisper 模型
public/ort/             内置 onnxruntime WASM 运行时
android/                Capacitor Android 工程
.github/workflows/      CI：构建 + Pages 发布 + 热更新包
```
