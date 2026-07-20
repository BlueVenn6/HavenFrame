const { withAndroidManifest, withGradleProperties } = require("@expo/config-plugins");

function upsertProperty(properties, key, value) {
  const existing = properties.find((entry) => entry.type === "property" && entry.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: "property", key, value });
}

module.exports = function withLocalAndroidBuild(config) {
  const withBuildSettings = withGradleProperties(config, (gradleConfig) => {
    upsertProperty(
      gradleConfig.modResults,
      "org.gradle.jvmargs",
      "-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8",
    );
    upsertProperty(gradleConfig.modResults, "org.gradle.parallel", "false");
    upsertProperty(gradleConfig.modResults, "android.enableMinifyInReleaseBuilds", "true");
    upsertProperty(gradleConfig.modResults, "android.enableShrinkResourcesInReleaseBuilds", "true");
    return gradleConfig;
  });

  return withAndroidManifest(withBuildSettings, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;
    const features = manifest["uses-feature"] || [];
    const cameraFeature = features.find(
      (feature) => feature.$?.["android:name"] === "android.hardware.camera",
    );

    if (cameraFeature) {
      cameraFeature.$["android:required"] = "false";
    } else {
      features.push({
        $: {
          "android:name": "android.hardware.camera",
          "android:required": "false",
        },
      });
    }
    manifest["uses-feature"] = features;
    return manifestConfig;
  });
};
