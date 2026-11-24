# netifd / hostapd 的 MLD 拆除竞态（本插件为什么要 `network restart`）

测试环境：Tenda BE12 Pro（MT7987A + MT7992E，驱动 `mt7996e`，固件 `mt7992`），
OpenWrt SNAPSHOT r0+37999 / FanchmWrt，hostapd 2.12，apk-tools 3.0.5。

## 现象

MLO 正常工作时（`ap-mld0`，两条 link），把配置从 MLD 改成 2.4G/5G 两个独立 AP，
然后执行 `wifi reload`（= `ubus call network reload`）：

```
hostapd: Remove MLD interface ap-mld0
hostapd: ap-mld0: interface state ENABLED->DISABLED
hostapd: nl80211: Failed to remove interface ap-mld0 from bridge br-lan: No such device
hostapd: nl80211: remove link (1) failed. ret=-19 (No such device)
wpa_supplicant: Start pending MLD interfaces
hostapd: Set new config for phy phy0.0:              <-- 空配置，正常应是 /var/run/hostapd-phy0.0.conf
netifd:  radio0: wifi-scripts: Starting
wpa_supplicant: Start pending MLD interfaces
...（之后 2 分钟没有任何 phy0.0 / phy0.1 的配置下发，也没有接口出现）
```

结果：`iw dev` 里**一个接口都没有**，无线彻底消失；`ubus call network.wireless status`
里设备仍显示 up，但 hostapd 没拿到任何 BSS 配置。

## 触发条件

拆 MLD 时内核已经把 MLD netdev 删掉，hostapd 随后去 `remove link` 报 `-19`，
它的 phy 级状态里残留了一份 MLD 引用；之后 netifd 生成 per-phy 配置时被判失败，
于是只下发空配置，而 netifd 又在等 `Start pending MLD interfaces`，形成死等。

## 试过的方案

| 方案 | 结果 |
| --- | --- |
| `wifi reload`（射频开着时） | 卡死（上面的日志） |
| `wifi down` → `ubus call network reload` → `wifi up` | 仍然卡死，且更不稳定 |
| `wifi down` → `/etc/init.d/wpad restart` → `wifi up` | wpad 一重启 netifd 就用**内存里的旧配置**把 MLD 又建起来，再改就乱 |
| `wifi down` 后等接口消失 → 改配置 → `wpad restart` → `wifi up` | 偶尔成功，不可靠 |
| **改配置 → `uci commit` → `/etc/init.d/network restart`** | 稳定，≤5 秒接口全部回来 |

`/etc/init.d/network restart` 会重启 netifd，整个无线状态从零重建，绕开了
hostapd 里的残留引用。代价是 WAN/LAN 也会跟着重来一次（几秒）。

## 插件里的做法

```
apply_enable / apply_disable   # 只改 uci，不动运行态
uci commit wireless
/etc/init.d/network restart
# 每 3 秒检查一次，最多 60 秒；不达标就再来一轮，仍失败则还原备份
```

关闭 MLO 时不现场"拆"，而是直接 `<开启前备份> → /etc/config/wireless`，
这样连配置层面都不会出现中间态。

## 参考

- 相关逻辑：`/lib/netifd/wireless.uc`（`wireless.mlo`、`hostapd_update_mlo`）、
  `/usr/share/hostap/hostapd.uc`（`bss_check_mld`、`mld_ap`）、
  `/usr/share/ucode/wifi/ap.uc`（`mld_links`、`mld_refusal`、`mld_ap=1`）
- hostapd 2.12 的 MLD link 增删、以及 mt76 驱动对 link 的拆除顺序
