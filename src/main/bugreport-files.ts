import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export function findGeneratedBugreport(directory: string): string {
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip")
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      return { filePath, info: statSync(filePath) };
    })
    .filter(({ info }) => info.size > 0)
    .sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);

  if (candidates.length === 0) {
    throw new Error("ADB 已结束，但没有生成有效的 ZIP 文件");
  }
  return candidates[0].filePath;
}
