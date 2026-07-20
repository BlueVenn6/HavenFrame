# Third-Party Notices

HavenFrame / 栖构的原创源码适用根目录 `LICENSE` 中的
`AGPL-3.0-or-later`。本许可证不会改变第三方组件各自的许可条款。

Original HavenFrame source code is licensed under `AGPL-3.0-or-later`.
Third-party components retain their respective licenses.

## Expo template notice

Parts of the mobile project were initially scaffolded with Expo tooling.
The preserved Expo MIT notice is available at
[`THIRD_PARTY_LICENSES/EXPO-MIT.txt`](THIRD_PARTY_LICENSES/EXPO-MIT.txt).

## Dependency manifests

The authoritative dependency inventories are:

- `app/package-lock.json`
- `app/src-tauri/Cargo.lock`
- `backend/requirements.txt`
- `mobile-expo/package-lock.json`

Dependencies are not vendored in the Git repository. Binary distributors
must review the licenses of the exact locked dependency set and include any
notices required by those dependencies.
