export const aspectRatioOptions = ["16:9", "4:3", "3:2", "1:1", "9:16", "3:4", "2:3"] as const;

export function aspectRatioToCss(value: string): string {
  const [width, height] = value.split(":").map((part) => Number(part));
  if (!width || !height) {
    return "1 / 1";
  }
  return `${width} / ${height}`;
}
