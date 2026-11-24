#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# apk post-install:
#   1. 留存"插件接管前"的无线配置快照（供一键恢复使用，永不覆盖）
#   2. 启用开机守护服务
[ -n "${IPKG_INSTROOT:-}" ] && exit 0

STATE_DIR=/etc/mlo
ORIG=/etc/mlo/wireless.orig

mkdir -p "$STATE_DIR" 2>/dev/null

# 只在首次安装时留存：升级/重装不能覆盖已有快照
if [ ! -f "$ORIG" ] && [ -f /etc/config/wireless ]; then
	cp /etc/config/wireless "$ORIG" 2>/dev/null
	{
		echo "$(date '+%F %T') [post-install] original snapshot saved: $ORIG"
		echo "$(date '+%F %T') [post-install]    from /etc/config/wireless (pre-install state)"
	} >> /var/log/mlo.log 2>/dev/null
fi

/etc/init.d/mlo-guard enable 2>/dev/null
/etc/init.d/mlo-guard restart 2>/dev/null

exit 0
