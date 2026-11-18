#!/bin/bash
# 临时调试脚本：把指定版本的三方插件装进 DSH Web profile。
#
# 由 `install_callback` 的 `run_debug_hook` 在**应用自己的运行环境**里执行，
# 执行后 hook 会删除自己。
#
# 用 `dsh plugin add <包名>@<版本>` 直接指定版本，**由 dsh/pnpm 自己从 registry
# 下载**——不需要预先往包里塞 tarball。这一点和「应用内安装插件」走的是同一条
# 路径，因此装上来的结果与用户真实操作一致。
#
# 环境变量（HOME=@appshare/<app>、DSH_HOME、PATH 等）已由 callback 设好，
# 不要在这里重设。
#
# 验证完把本文件与 install_callback 里的 run_debug_hook 一起删掉。

set -u

PROFILE="${DSH_HOME}/profiles/web"

echo "node: $(command -v node) $(node --version 2>/dev/null)"
echo "pnpm: $(command -v pnpm) $(pnpm --version 2>/dev/null)"
echo "store: $(pnpm store path 2>/dev/null)"
echo "profile: ${PROFILE}"

# 包名@版本。选这几个是为了覆盖「版本比较」的各种形态：
#   - 低于 registry 最高版 → 应提示有更新
#   - 与最高版相同         → 不应提示
#   - @tnnevol/* 的 latest tag 长期滞后，但 next 上有更高版本 → 应提示有更新
SPECS=(
  "dshmarket@1.66.47"
  "@fnnas-labs/fnos-cli@0.6.1"
  "dsh-pet@0.4.5"
  "dsh-taskboard@0.9.11"
  "@tnnevol/dsh-codex-auth@8.1.135"
  "@tnnevol/dsh-failover-search@8.1.3"
  "@tnnevol/dsh-opencode@8.1.3"
)

FAILED=0
for spec in "${SPECS[@]}"; do
    echo "── 安装 ${spec}"
    # `--config.minimum-release-age=0` 必须带：部分版本仍在冷静期内。
    out="$(cd "${PROFILE}" && dsh plugin --profile web add "${spec}" \
        --config.minimum-release-age=0 2>&1)"
    code=$?
    printf '%s\n' "${out}" | tail -3 | sed 's/^/   /'
    if [ "${code}" -ne 0 ]; then
        echo "   FAILED: 退出码 ${code}"
        FAILED=$((FAILED + 1))
    else
        echo "   OK"
    fi
done

echo "════ 装后实际版本 ════"
for spec in "${SPECS[@]}"; do
    name="${spec%@*}"
    want="${spec##*@}"
    manifest="${PROFILE}/node_modules/${name}/package.json"
    actual="$(python3 -c "
import json
try:
    print(json.load(open('${manifest}')).get('version','?'))
except Exception:
    print('MISSING')
" 2>/dev/null)"
    [ "${actual}" = "${want}" ] && mark="✓" || mark="✗"
    printf '  %s %-32s 期望 %-10s 实际 %s\n' "${mark}" "${name}" "${want}" "${actual}"
done
echo "失败数: ${FAILED}"
exit 0
