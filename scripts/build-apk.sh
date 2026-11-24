#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# 构建 luci-app-mlo 的 .apk（apk-tools v3 / ADB 格式，OpenWrt 25.12+ 使用）
#
# 用法:
#   sh scripts/build-apk.sh                    # 默认 aarch64_cortex-a53
#   ARCH=x86_64 sh scripts/build-apk.sh        # 指定目标架构
#   OUT=/tmp dist sh scripts/build-apk.sh      # 指定输出目录
#
# 依赖:
#   * 一个带 mkpkg 的 apk-tools 3.x（Alpine 的 apk 自带）；
#     如果没有（例如在 macOS / 普通 Linux / OpenWrt 上），脚本会自动下载
#     Alpine 官方的 apk-tools-static 来用。
#   * curl 或 wget 之一（只有走静态下载时才需要）。
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NAME=luci-app-mlo
VERSION=$(cat "$ROOT/VERSION")
ARCH=${ARCH:-aarch64_cortex-a53}
OUT=${OUT:-$ROOT/dist}
SRC=$ROOT/files
POSTINST=$ROOT/scripts/post-install.sh
DESC="One-click MLO (Wi-Fi 7 multi-link) toggle for OpenWrt 25.12+ / FanchmWrt"

fetch() { # fetch <url> [output|-]
	url=$1
	out=${2:-}
	if [ -z "$out" ] || [ "$out" = "-" ]; then
		if command -v curl >/dev/null 2>&1; then
			curl -fsSL "$url"
		elif command -v wget >/dev/null 2>&1; then
			wget -q -O - "$url"
		else
			echo "需要 curl 或 wget" >&2
			return 1
		fi
	elif command -v curl >/dev/null 2>&1; then
		curl -fsSL -o "$out" "$url"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$out" "$url"
	else
		echo "需要 curl 或 wget" >&2
		return 1
	fi
}

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t mlo)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT"

# git 里记录了可执行位，但有些文件系统/压缩包会丢，这里再兜一次
chmod +x "$SRC/usr/bin/mlo-toggle" "$SRC/usr/bin/mlo-boot-guard" "$SRC/usr/bin/mlo-lan-guard" "$SRC/etc/init.d/mlo-guard"

# ---------------------------------------------------------------- mkpkg ----
APK_STATIC=
if command -v apk >/dev/null 2>&1 && apk mkpkg --help 2>&1 | grep -q 'mkpkg'; then
	echo ">> 使用系统 apk (mkpkg)"
else
	HOST_ARCH=$(uname -m)
	case "$HOST_ARCH" in
		x86_64|aarch64|armv7l) ;;
		*) echo "!! 不支持自动获取 mkpkg 的主机架构: $HOST_ARCH" >&2; exit 1 ;;
	esac

	BASE="https://dl-cdn.alpinelinux.org/alpine/edge/main/$HOST_ARCH"
	echo ">> 当前 apk 没有 mkpkg，获取 apk-tools-static ($HOST_ARCH)"
	VER=$(fetch "$BASE/APKINDEX.tar.gz" - | tar -xzO APKINDEX 2>/dev/null |
		awk '/^P:apk-tools-static$/{f=1;next} f&&/^V:/{print substr($0,3);exit}') || VER=
	[ -n "$VER" ] || VER=3.0.10-r1
	echo "   apk-tools-static $VER"
	fetch "$BASE/apk-tools-static-$VER.apk" "$WORK/tools.apk"
	tar -xzf "$WORK/tools.apk" -C "$WORK"
	APK_STATIC="$WORK/sbin/apk.static"
	chmod +x "$APK_STATIC"
fi

mkpkg() {
	if [ -n "$APK_STATIC" ]; then
		"$APK_STATIC" mkpkg "$@"
	else
		apk mkpkg "$@"
	fi
}

# ----------------------------------------------------------------- 打包 ----
PKG=$OUT/$NAME-$VERSION-$ARCH.apk
rm -f "$PKG"

echo ">> 打包 $NAME $VERSION ($ARCH)"
mkpkg \
	--info "name:$NAME" \
	--info "version:$VERSION" \
	--info "description:$DESC" \
	--info "license:GPL-2.0" \
	--info "arch:$ARCH" \
	--info "origin:$NAME" \
	--info "url:https://github.com/" \
	--info "depends:luci-base" \
	--script "post-install:$POSTINST" \
	--files "$SRC" \
	-o "$PKG"

[ -s "$PKG" ] || { echo "!! 打包失败" >&2; exit 1; }

# ---------------------------------------------------------------- 校验 ----
echo ">> 产物"
ls -l "$PKG"
if command -v sha256sum >/dev/null 2>&1; then
	sha256sum "$PKG"
elif command -v shasum >/dev/null 2>&1; then
	shasum -a 256 "$PKG"
fi

if [ -n "$APK_STATIC" ] && [ -x "$APK_STATIC" ]; then
	"$APK_STATIC" adbdump "$PKG" 2>/dev/null | head -6 || true
elif command -v apk >/dev/null 2>&1; then
	apk adbdump "$PKG" 2>/dev/null | head -6 || true
fi
