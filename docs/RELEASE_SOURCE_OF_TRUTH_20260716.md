# Release Source Of Truth

## 冻结桌面版本

- Branch：`desktop-cn-frozen-20260716`
- Tag：`qigou-desktop-cn-frozen-20260716`
- Commit：`23475f1b8557d5115da14f4856755cee7e6c0a73`
- 冻结内容：桌面图片中转与 GLM 提取线路隔离；后端拒绝带旧 `vision_model_id` 的图片中转提取配置。

## 当前双语开发分支

- Branch：`bilingual-cn-en-20260716`
- Base commit：`23475f1b8557d5115da14f4856755cee7e6c0a73`
- 当前状态：尚未启用英文 UI。仓库原有界面有大量组件内中文文本，未完成覆盖前不启用 English 选项，避免语言混杂。

## Android Release 产物

- Path：`mobile-expo/android/app/build/outputs/apk/release/app-release.apk`
- SHA-256：`89E73F16C6ADB12DFA52B8ED86BF1FA957BE6AA6FF2D2C76FD50C7D3A38B316C`
- Package：`com.qigou.mobile`
- 产物包含：`assets/index.android.bundle`
- 真机安装验证：未执行，当前 `adb devices` 没有设备。

## 不可混用的状态

`app-debug.apk` 只是本地开发编译验证，不是给测试人员直接安装的交付包。内部测试必须使用 Release 包，并在构建时注入真实 HTTPS API 地址。

