# Android 启动日志审计

日期：2026-07-16

## 结论

提供的日志没有记录当前仓库 Android 包的启动崩溃。日志中的主要 React Native 崩溃进程是 `com.photomanager.app.validation`，而当前仓库包名是 `com.qigou.mobile`。

日志中的异常是：

```text
Screen fragments should never be restored
com.swmansion.rnscreens.ScreenFragment
```

当前仓库的 `mobile-expo/android/app/src/main/java/com/qigou/mobile/MainActivity.kt` 已使用 `super.onCreate(null)`，不会把旧 Fragment 状态交给 `react-native-screens` 恢复。

## 交付物核对

| 项目 | 日志/产物值 |
| --- | --- |
| 当前 Android 包名 | `com.qigou.mobile` |
| 日志崩溃包名 | `com.photomanager.app.validation` |
| Debug 包 | 不适合作为独立安装交付，依赖 Metro bundle |
| Release 包 | `mobile-expo/android/app/build/outputs/apk/release/app-release.apk` |
| Release 包是否含 JS bundle | 是，`assets/index.android.bundle` |
| 设备是否连接 | 否，`adb devices` 为空 |

## 当前限制

Release 包仍需在构建时注入真实、设备可访问的 HTTPS API Base URL。仓库没有提供该地址，因此不能伪造“安装后业务可用”的结论。

