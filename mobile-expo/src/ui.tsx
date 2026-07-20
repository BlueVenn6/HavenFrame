import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  SafeAreaView,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { WebView } from "react-native-webview";

import { colors, shadow } from "./theme";
import { useMobileLocale } from "./i18n";

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitle}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const variantStyle = variant === "primary" ? styles.buttonPrimary : variant === "danger" ? styles.buttonDanger : styles.buttonSecondary;
  const textStyle = variant === "primary" || variant === "danger" ? styles.buttonPrimaryText : styles.buttonSecondaryText;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, variantStyle, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed, style]}
    >
      <Text style={[styles.buttonText, textStyle, disabled && styles.buttonDisabledText]}>{children}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "url";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        textAlignVertical={multiline ? "top" : "center"}
        autoCapitalize="none"
        style={[styles.field, multiline && styles.textArea]}
      />
    </View>
  );
}

export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  labelForOption,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  labelForOption?: (value: T) => string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.chip, value === option && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === option && styles.chipTextActive]}>{labelForOption?.(option) ?? option}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const style = tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : tone === "bad" ? styles.pillBad : styles.pillNeutral;
  return (
    <View style={[styles.pill, style]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function LoadingInline({ label }: { label?: string }) {
  const { text } = useMobileLocale();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primaryDark} />
      <Text style={styles.loadingText}>{label ?? text("加载中...", "Loading...")}</Text>
    </View>
  );
}

export function AlertText({ text, tone = "warn" }: { text?: string; tone?: "warn" | "bad" | "good" }) {
  if (!text) return null;
  const style = tone === "good" ? styles.alertGood : tone === "bad" ? styles.alertBad : styles.alertWarn;
  return (
    <View style={[styles.alert, style]}>
      <Text style={styles.alertText}>{text}</Text>
    </View>
  );
}

export function PreviewImage({
  uri,
  headers,
  label,
  mimeType,
  style,
  containerStyle,
}: {
  uri?: string;
  headers?: Record<string, string>;
  label: string;
  mimeType?: string | null;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const isSvg = Boolean(uri && (mimeType === "image/svg+xml" || uri.toLowerCase().includes(".svg")));
  return (
    <View style={[styles.preview, containerStyle]}>
      {uri && isSvg ? (
        <WebView
          originWhitelist={["*"]}
          source={{ uri, headers }}
          style={styles.previewWebview}
          scrollEnabled={false}
          javaScriptEnabled={false}
          domStorageEnabled={false}
        />
      ) : uri ? (
        <Image source={{ uri, headers }} style={[styles.previewImage, style]} resizeMode="cover" />
      ) : (
        <Text style={styles.previewText}>{label}</Text>
      )}
    </View>
  );
}

export interface ImageViewerSource {
  uri: string;
  label: string;
  mimeType?: string | null;
  headers?: Record<string, string>;
}

export function ImageViewerModal({
  visible,
  image,
  onClose,
}: {
  visible: boolean;
  image: ImageViewerSource | null;
  onClose: () => void;
}) {
  const { text } = useMobileLocale();
  const isSvg = Boolean(image?.uri && (image.mimeType === "image/svg+xml" || image.uri.toLowerCase().includes(".svg")));
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.viewerOverlay}>
        <SafeAreaView style={styles.viewerShell}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle} numberOfLines={1}>
              {image?.label || text("图片预览", "Image preview")}
            </Text>
            <Button variant="secondary" onPress={onClose}>
              {text("关闭", "Close")}
            </Button>
          </View>
          <View style={styles.viewerBody}>
            {image?.uri ? (
              isSvg ? (
                <WebView
                  originWhitelist={["*"]}
                  source={{ uri: image.uri, headers: image.headers }}
                  style={styles.viewerWebview}
                  scrollEnabled={false}
                  javaScriptEnabled={false}
                  domStorageEnabled={false}
                />
              ) : (
                <Image source={{ uri: image.uri, headers: image.headers }} style={styles.viewerImage} resizeMode="contain" />
              )
            ) : (
              <Text style={styles.viewerEmpty}>{text("暂无可预览内容", "Nothing to preview")}</Text>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function KeyValue({ label, value, valueStyle }: { label: string; value?: string | number | null; valueStyle?: StyleProp<TextStyle> }) {
  const { text } = useMobileLocale();
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, valueStyle]}>{value ?? text("暂无", "None")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    ...shadow,
  },
  sectionTitle: {
    gap: 4,
    marginBottom: 10,
  },
  eyebrow: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    color: colors.navy,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  button: {
    minHeight: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonDanger: {
    backgroundColor: colors.rose,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    backgroundColor: "#E2E8F0",
    borderColor: "#E2E8F0",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "800",
  },
  buttonPrimaryText: {
    color: "#FFFFFF",
  },
  buttonSecondaryText: {
    color: colors.ink,
  },
  buttonDisabledText: {
    color: "#64748B",
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  field: {
    minHeight: 42,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    color: colors.navy,
    fontSize: 14,
    fontWeight: "600",
  },
  textArea: {
    minHeight: 96,
    paddingTop: 12,
    lineHeight: 20,
  },
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 40,
  },
  chipRow: {
    alignItems: "center",
    gap: 7,
    minHeight: 40,
    paddingRight: 4,
  },
  chip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  chipTextActive: {
    color: "#FFFFFF",
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillNeutral: {
    backgroundColor: "#E2E8F0",
  },
  pillGood: {
    backgroundColor: colors.emeraldBg,
  },
  pillWarn: {
    backgroundColor: colors.amberBg,
  },
  pillBad: {
    backgroundColor: colors.roseBg,
  },
  pillText: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: "800",
  },
  empty: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 16,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  alert: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 11,
  },
  alertWarn: {
    backgroundColor: colors.amberBg,
    borderColor: "#FCD34D",
  },
  alertBad: {
    backgroundColor: colors.roseBg,
    borderColor: "#FDA4AF",
  },
  alertGood: {
    backgroundColor: colors.emeraldBg,
    borderColor: "#6EE7B7",
  },
  alertText: {
    color: colors.navy,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  preview: {
    height: 156,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: "#F0FDFA",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewWebview: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
  previewText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.92)",
  },
  viewerShell: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  viewerTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  viewerBody: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: {
    width: "100%",
    height: "100%",
  },
  viewerWebview: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
  viewerEmpty: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  kv: {
    flex: 1,
    minWidth: 130,
    gap: 4,
  },
  kvLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  kvValue: {
    color: colors.navy,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
});
