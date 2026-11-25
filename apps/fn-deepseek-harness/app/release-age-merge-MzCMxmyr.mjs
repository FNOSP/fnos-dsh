import { readFile, writeFile } from "node:fs/promises";
//#region src/install-callback-helper/release-age-merge.ts
/**
* 把 `minimumReleaseAgeExclude` 里**同一个包的多个版本**合并成一行。
*
* ## 为什么必须合并
*
* pnpm 解析这个列表是 **First-Match-Wins**：逐条比对包名，第一条匹配即停止。
* 于是同一包写成两行时：
*
* ```yaml
* minimumReleaseAgeExclude:
*   - dshmarket@1.84.0     # 先匹配到包名，版本不符 → 短路
*   - dshmarket@1.84.1     # 这条永远不生效
* ```
*
* `dshmarket@1.84.1` 因此不被豁免，lockfile 校验报
* `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，整个 `dsh plugin remove/add` 失败。
*
* 2026-11-25 真机实测：正是这个短路让升级在 `remove` 阶段中断，插件被移出 profile
* 而装不回来，fnOS 的全部界面入口消失。
*
* ## 为什么由我们合并，而不是 pnpm 自己
*
* pnpm 较新版本确实会在写入时合并（`mergePackageVersionSpecs`），但设备上是
* pnpm 11.7.0——它的写入路径**逐条追加**，留下多行。等到那个版本才有修复并不现实，
* 而这个缺陷会让升级直接失败，所以这里按 pnpm 自己的目标格式做一次规范化。
*
* **只做格式，不做判断**：不判断哪个版本在冷静期内、也不增减条目，只把已有的
* 同包多版本按 semver 排序后用 `' || '` 连成一行——与 pnpm 新版本写出的形状一致。
*
* @module fnos-gateway/install-callback-helper/release-age-merge
*/
/** 段头。 */
const SECTION = "minimumReleaseAgeExclude:";
/**
* 解析一条条目为「包名 + 版本列表」。
*
* 形如 `@scope/pkg@1.2.3`、`pkg@1.2.3 || 1.2.4`、裸包名（无版本）。
* @param raw - 原始条目文本（已去掉列表符号）。
* @returns 包名与版本数组；无版本时数组为空。
*/
function parseEntry(raw) {
	const value = raw.trim().replace(/^['"]|['"]$/gu, "");
	const at = value.lastIndexOf("@");
	if (at <= 0) return {
		name: value,
		versions: []
	};
	return {
		name: value.slice(0, at),
		versions: value.slice(at + 1).split("||").map((part) => part.trim()).filter((part) => part.length > 0)
	};
}
/**
* 按 semver 排序版本号。
*
* 用逐段数值比较而不是字典序：`1.9.0` 必须排在 `1.10.0` 之前，字典序会反过来。
* 预发布段（`-rc.2`）按字符串比较即可——同包的多版本里预发布顺序不影响豁免语义。
* @param left - 版本号。
* @param right - 版本号。
* @returns 排序结果。
*/
function compareVersion(left, right) {
	const split = (value) => {
		const dash = value.indexOf("-");
		const core = dash < 0 ? value : value.slice(0, dash);
		const pre = dash < 0 ? "" : value.slice(dash + 1);
		return {
			core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
			pre
		};
	};
	const a = split(left);
	const b = split(right);
	for (let i = 0; i < Math.max(a.core.length, b.core.length); i += 1) {
		const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return a.pre === b.pre ? 0 : a.pre < b.pre ? -1 : 1;
}
/**
* 合并工作区文件里的同包多版本条目。
* @param workspaceFile - `pnpm-workspace.yaml` 的绝对路径。
* @returns 是否发生了改动。
*/
async function mergeReleaseAgeExclusions(workspaceFile) {
	let text;
	try {
		text = await readFile(workspaceFile, "utf8");
	} catch {
		return false;
	}
	const lines = text.split("\n");
	const start = lines.findIndex((line) => line.trimEnd() === SECTION);
	if (start < 0) return false;
	let end = start + 1;
	for (; end < lines.length; end += 1) {
		const line = lines[end] ?? "";
		if (/^[^\s#-]/u.test(line)) break;
	}
	const entryIndexes = [];
	const byName = /* @__PURE__ */ new Map();
	for (let i = start + 1; i < end; i += 1) {
		const matched = /^(\s+)-\s*(.+?)\s*$/u.exec(lines[i] ?? "");
		if (matched === null) continue;
		entryIndexes.push(i);
		const parsed = parseEntry(matched[2] ?? "");
		const existing = byName.get(parsed.name);
		const indent = matched[1] ?? "  ";
		if (existing === void 0) byName.set(parsed.name, {
			versions: new Set(parsed.versions),
			indent,
			bareNames: new Set(parsed.versions.length === 0 ? [parsed.name] : [])
		});
		else {
			for (const version of parsed.versions) existing.versions.add(version);
			if (parsed.versions.length === 0) existing.bareNames.add(parsed.name);
		}
	}
	if (entryIndexes.length === 0) return false;
	const order = [...byName.keys()];
	const rebuilt = [];
	for (const name of order) {
		const info = byName.get(name);
		if (info === void 0) continue;
		if (info.bareNames.has(name) || info.versions.size === 0) {
			rebuilt.push(`${info.indent}- ${name}`);
			continue;
		}
		const versions = [...info.versions].sort(compareVersion);
		rebuilt.push(`${info.indent}- ${name}@${versions.join(" || ")}`);
	}
	let nextText = [
		...lines.slice(0, start + 1),
		...rebuilt,
		...lines.slice(end)
	].join("\n");
	if (text.endsWith("\n") && !nextText.endsWith("\n")) nextText += "\n";
	if (nextText === text) return false;
	await writeFile(workspaceFile, nextText, "utf8");
	return true;
}
//#endregion
export { mergeReleaseAgeExclusions };
