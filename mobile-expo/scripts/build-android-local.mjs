import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(root, "..");
const isInternalRelease = process.argv.includes("--internal-release");
const prepareOnly = process.argv.includes("--prepare-only");
const appConfig = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo;
const sourceCommit = gitOutput(["rev-parse", "HEAD"]);
const sourceStatus = gitOutput(["status", "--porcelain"]);
const buildStartedAt = new Date().toISOString();

if (isInternalRelease && sourceStatus) {
  console.error("FAIL Android internal release: Git worktree must be clean before packaging.");
  console.error(sourceStatus);
  process.exit(1);
}
const environment = {
  ...process.env,
  EXPO_NO_TELEMETRY: "1",
  NODE_ENV: isInternalRelease ? "production" : (process.env.NODE_ENV || "development"),
};

run(process.execPath, [path.join(root, "node_modules", "expo", "bin", "cli"), "prebuild", "--platform", "android", "--no-install"], root);
ensureDebugKeystore();

if (!prepareOnly) {
  const task = isInternalRelease ? "app:assembleRelease" : "app:assembleDebug";
  const args = [task, "--no-daemon", "--max-workers=1", "--no-configuration-cache", "--console=plain"];
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "gradlew.bat", ...args], path.join(root, "android"));
  } else {
    run("./gradlew", args, path.join(root, "android"));
  }
  writeArtifactManifest();
}

function writeArtifactManifest() {
  const variant = isInternalRelease ? "release" : "debug";
  const sourceApk = path.join(root, "android", "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
  if (!existsSync(sourceApk)) {
    throw new Error(`Expected Android APK was not produced: ${sourceApk}`);
  }
  const version = String(appConfig.version);
  const versionCode = Number(appConfig.android.versionCode);
  const outputDir = path.join(root, "artifacts", "android", `${version}-build${versionCode}`);
  const outputName = `HavenFrame-${version}-build${versionCode}-${isInternalRelease ? "internal-release" : "debug"}.apk`;
  const outputApk = path.join(outputDir, outputName);
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(sourceApk, outputApk);
  const manifest = {
    release_version: version,
    version_code: versionCode,
    variant,
    signing: isInternalRelease ? "debug-keystore (internal testing only)" : "debug-keystore",
    git_commit: sourceCommit,
    git_status: sourceStatus || "clean",
    build_started_at: buildStartedAt,
    build_finished_at: new Date().toISOString(),
    apk: {
      path: path.relative(repositoryRoot, outputApk),
      size: statSync(outputApk).size,
      sha256: sha256(outputApk),
    },
  };
  const manifestPath = path.join(outputDir, "release-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`android_artifact=${outputApk}`);
  console.log(`android_manifest=${manifestPath}`);
  console.log(`android_apk_sha256=${manifest.apk.sha256}`);
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}

function sha256(filePath) {
  const digest = createHash("sha256");
  const data = readFileSync(filePath);
  digest.update(data);
  return digest.digest("hex").toUpperCase();
}

function ensureDebugKeystore() {
  const target = path.join(root, "android", "app", "debug.keystore");
  if (existsSync(target)) return;

  mkdirSync(path.dirname(target), { recursive: true });
  const executable = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
    : "keytool";
  run(executable, [
    "-genkeypair",
    "-storetype", "JKS",
    "-keystore", target,
    "-storepass", "android",
    "-alias", "androiddebugkey",
    "-keypass", "android",
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10000",
    "-dname", "CN=Android Debug,O=Android,C=US",
  ], root);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
