# luci-app-mlo

给 **OpenWrt 25.12+ / FanchmWrt** 的 Wi-Fi 7 路由器用的 **MLO 一键开关** 插件：
点一下把 2.4G / 5G 合并成多链路（AP MLD），再点一下拆回两个独立 AP。

后台入口：**网络 → MLO 多链路**。

> 开发/验证机型：Tenda BE12 Pro（MT7987A + MT7992E，`mediatek/filogic`，
> OpenWrt SNAPSHOT r0+37999 / FanchmWrt，hostapd 2.12，apk-tools 3.0.5）。
> 其他使用 netifd + hostapd 2.12 + apk 的 OpenWrt 25.12 机型应该同样可用。

---

## 为什么需要它

OpenWrt 原生没有 MLO 开关，只能在 `/etc/config/wireless` 里手写：

```uci
config wifi-iface 'mlo0'
	option device 'radio0 radio1'   # 两个射频组成一个 MLD
	option mode 'ap'
	option ssid '...'
	option encryption 'psk2'
	option key '...'
	option mlo '1'                  # 关键
```

而且**不能随便 reload**：在 mt7996e + hostapd 2.12 上直接 `wifi reload`
拆 MLD 会触发竞态，netifd 卡在 `Start pending MLD interfaces`，无线再也起不来
（详见 [docs/netifd-mlo-bug.md](docs/netifd-mlo-bug.md)）。本插件把这些坑都包好了。

## 功能

- **一键开 / 一键关**，网页和命令行都有；
- 关闭时**直接还原开启前那份配置**，后台「无线」页面立刻恢复成 radio0 / radio1
  两个 AP（不是现场拆，避免踩竞态）；
- SSID / 密码 / 加密方式不变：单链路设备照旧走 WPA2，Wi-Fi 7 设备自动多链路
  （hostapd 在 RSNE Override 2 里给出 `SAE-EXT-KEY / GCMP-256`）；
- 切换后**自动校验**，失败自动回滚；
- **开机守护**：冷启动后 150 秒仍没有任何无线接口时，自动回退双 AP 配置
  （避免"开了 MLO 之后开机没 WiFi"）；
- 状态里能看到每条链路的频段 / 信道 / 带宽、在线客户端数、MLO 客户端数。

## 安装

从 [Releases](../../releases) 下载对应架构的 apk（文件名里带架构，要和设备一致，
`aarch64_cortex-a53` 对应 Filogic 平台），然后：

```sh
apk add --allow-untrusted /tmp/luci-app-mlo-1.0.4-r1-aarch64_cortex-a53.apk
```

发布规则：

- **每次 push 到 `main`** → 自动构建，并把产物更新到滚动版
  [`latest` Release](../../releases/tag/latest)（预发布，四个架构都带）；
- **打 `v*` tag** → 发对应版本的正式 Release（同样附全部架构的 apk）。

`--allow-untrusted` 是必须的：这是第三方包，`apk add` 仍会按包内哈希校验文件，
装完写入 world，重启后仍在。

确认架构：

```sh
apk --print-arch
```

装完刷新 LuCI，进入 **网络 → MLO 多链路**。

## 使用

网页：点按钮即可，切换过程无线会重启一次，**约 20~40 秒**所有设备断线重连
（5 GHz DFS 信道冷启动可能再等最多 60 秒）。

命令行（等价）：

```sh
mlo-toggle status     # 输出 JSON 状态
mlo-toggle enable     # 开 MLO
mlo-toggle disable    # 关 MLO（还原备份，回到两个 AP）
mlo-toggle toggle     # 一键切换
mlo-toggle restore    # 强制还原 /etc/mlo/wireless.off
```

- 日志：`/var/log/mlo.log`
- 备份：`/etc/mlo/wireless.off`（首次开启 MLO 时生成）
- 单次切换失败会在日志里写明原因，并自动回滚

## 自动备份（安装即生效）

插件在**安装的那一刻**就会把当前的 `/etc/config/wireless` 存成
`/etc/mlo/wireless.orig`，**永不覆盖**（升级、重装、反复开关 MLO 都不会动它）。

所以装完立刻就能用页面上的「恢复插件安装前的配置」按钮，不需要先开一次 MLO。

- 快照路径：`/etc/mlo/wireless.orig`
- 生成时机：apk post-install（首次安装时；升级不覆盖）
- 手动恢复：`mlo-toggle factory`

## 卸载

```sh
apk del luci-app-mlo
rm -f /etc/rc.d/K05mlo-guard /etc/rc.d/S95mlo-guard   # 运行时生成的软链
```

卸载只删程序，不动 `/etc/config/wireless`。如果卸载时正开着 MLO，无线仍按 MLD
跑；想回到两个 AP，先 `mlo-toggle disable` 再卸载。

## 自己编译

### GitHub Actions（推荐）

推上去就自动编译，打 tag（如 `v1.0.1-r1`）会自动发 Release 并附上各架构 apk：

```sh
git tag v1.0.4-r1
git push origin v1.0.4-r1
```

架构矩阵在 [.github/workflows/build.yml](.github/workflows/build.yml) 的
`matrix.arch` 里，只需要自己的机型就删到只剩一行。产物在 Actions 的 Artifacts 里。

### 本地

需要 `sh` + `curl`/`wget`；打包工具（`apk mkpkg`）没有的话脚本会自动下载
Alpine 官方的 `apk-tools-static` 来用，所以 macOS / Linux / WSL 都能跑：

```sh
sh scripts/build-apk.sh                        # 默认 aarch64_cortex-a53
ARCH=x86_64 sh scripts/build-apk.sh            # 指定架构
OUT=dist sh scripts/build-apk.sh
```

或者用 `make`：

```sh
make            # = make apk
make deploy ROUTER=root@192.168.1.1   # 编译并推到路由器安装
make clean
```

产物：`dist/luci-app-mlo-<version>-<arch>.apk`（apk-tools v3 / ADB 格式）。

> 说明：这个包全是脚本和 JS，理论上与 CPU 无关，但 apk 要求 `arch` 字段和
> `/etc/apk/arch` 一致（`arch:all` 在 apk 3 里装不上），所以按目标架构各打一份。

## 目录结构

```
.
├── VERSION                     # apk 版本号（脚本读取）
├── files/                      # 安装树，和路由器根目录一一对应
│   ├── etc/init.d/mlo-guard            # 开机守护服务
│   ├── usr/bin/mlo-toggle              # 后端：status/enable/disable/toggle/restore
│   ├── usr/bin/mlo-boot-guard          # 开机检查
│   ├── usr/bin/mlo-lan-guard           # LAN 设备名自愈（防 LuCI 写坏 br-lan）
│   ├── usr/share/luci/menu.d/          # 菜单项
│   ├── usr/share/rpcd/acl.d/           # 只允许网页执行 mlo-toggle
│   └── www/luci-static/resources/view/mlo/overview.js
├── scripts/
│   ├── build-apk.sh            # 打包脚本（自动找 mkpkg）
│   └── post-install.sh         # apk post-install：启用守护服务
├── docs/netifd-mlo-bug.md      # netifd/MLD 竞态的复现记录
└── .github/workflows/build.yml # CI
```

## 老旧 IoT 设备连不上？（重要）

开 MLO 后，AP 会自动启用 **PMF（802.11w）** 和 **beacon 保护**（IEEE 802.11be 的要求）。
老式 IoT 设备（小米空调伴侣2、部分插座/传感器）只支持 WPA2-PSK 且**不能处理 PMF**，
表现为「一直卡在连接中，最后失败」。

### ⚠️ 不要直接给 lan 加第二个 wifi-iface

网上常见的做法是「再开一个 `ieee80211w=0` 的 2.4G SSID 给 IoT」。**在这套 netifd 上会出事**：

两个 AP 都 `option network 'lan'` 时，netifd 会把这个 wifi-iface 直接当成
`lan` 的物理设备，把 `lan` 的 `l3_device` 从 `br-lan` 改成该无线接口，结果
**主 SSID 被踢出网桥、拿不到 DHCP**（IoT 反而正常）。实测现象：

```sh
ubus call network.interface.lan status | grep l3_device
# "l3_device": "phy0.0-ap1"   <- 应该是 "br-lan" 或 "ap-mld0"
ip -4 addr show br-lan         # br-lan 直接不存在
```

### 正确做法

IoT 必须走**独立的 network**（独立网段/独立桥），不要复用 `lan`：

```sh
# 1) 建独立网络
uci set network.iot=interface
uci set network.iot.proto='static'
uci set network.iot.device='br-iot'
uci set network.iot.ipaddr='172.16.2.1'
uci set network.iot.netmask='255.255.255.0'

uci set network.br_iot=device
uci set network.br_iot.type='bridge'
uci set network.br_iot.name='br-iot'

# 2) IoT AP 挂到独立网络
uci set wireless.iot_2g=wifi-iface
uci set wireless.iot_2g.device='radio0'
uci set wireless.iot_2g.mode='ap'
uci set wireless.iot_2g.network='iot'      # 关键：不是 lan
uci set wireless.iot_2g.ssid='你的WiFi名_IoT'
uci set wireless.iot_2g.encryption='psk2'
uci set wireless.iot_2g.key='你的密码'
uci set wireless.iot_2g.ieee80211w='0'     # 关 PMF，老设备才能连

uci commit network && uci commit wireless
/etc/init.d/network restart
```

这样 IoT 在 `172.16.2.0/24` 独立网段，主 WiFi 的 `br-lan` 不受影响，两边都能拿 DHCP。
（需要 IoT 设备被主网段访问时，再在防火墙里放行 `iot -> lan`。）

> 如果只想让老设备先能用、不想折腾网段：**直接 `mlo-toggle disable` 关掉 MLO**。
> 关掉后没有 PMF/beacon 保护，老设备立刻能连主 SSID。

### 其他注意

- 改完必须 `/etc/init.d/network restart`，`wifi reload` 有时不会加载新 AP。
- 插件 1.0.2 起，`enable` / `disable` / `restore` 都会**保留**你自己建的
  这类自定义 SSID（1.0.0/1.0.1 会连 IoT 配置一起删掉）。

## ⚠️ 有线网口全部离线（LAN 不通 / 拿不到 DHCP）

**现象**：WiFi 正常，但插在 LAN 口（lan3/lan4/lan5）的设备全部显示离线，
`只看到 WAN 口已连接`。

**根因**：`network.lan.device` 被写坏了。正常应该只有一个 `br-lan`：

```sh
uci get network.lan.device
# 正常: br-lan
# 坏了: br-lan radio0 radio1.network1
```

多出来的是 LuCI 在编辑无线时自动塞进去的设备名。netifd 解析不了这种混合值，
结果 **`br-lan` 桥压根没被创建**，三个物理口全 DOWN，DHCP 自然全灭。

**判断方法**：

```sh
ip -br link            # lan3/lan4/lan5 都是 DOWN，且没有 br-lan
ls /sys/class/net/br-lan/brif/   # 目录不存在
ubus call network.interface.lan status | grep l3_device
# 会显示 ap-mld0 之类，而不是 br-lan
```

**修复**（一行）：

```sh
uci set network.lan.device='br-lan'
uci commit network
/etc/init.d/network restart
```

修复后应看到：`br-lan` 带上了管理网段的 IP（如 `192.168.1.1/24`），`lan3/lan4/lan5/eth1` 全部 UP，
`ls /sys/class/net/br-lan/brif/` 列出这 4 个成员。

**已自动防护（1.0.3+）**：插件自带 `mlo-lan-guard` 守护，开机时和每次
`/etc/config/network` 变更后都会检查 `network.lan.device`，发现被写坏就自动改回
`br-lan` 并重启网络（实测坏掉后 20 秒内自动恢复）。所以现在**在 LuCI 无线页面
保存也不会再让有线网口掉线**。

守护日志：`/var/log/mlo.log`（搜 `[lan-guard]`）；手动停用：
`/etc/init.d/mlo-guard stop`。

## 已知限制

- 需要固件自带 `hostapd` 2.12+（支持 `mld_ap=1`）和 netifd 的 MLO 支持；
  老固件没有这些，插件会报"新配置未生效"并回滚。
- 客户端要支持 802.11be 才能用多链路；Wi-Fi 6/5 设备只是单链路连在同一个 SSID 上。
- 开着 MLO 时 LuCI「无线」页面只会显示一个 `ap-mld0`，5G 那行显示 `?`——
  这是 LuCI 的显示限制（MLD 只有一个网卡实体），不是故障。

## License

GPL-2.0，完整条款见 [LICENSE](LICENSE)（与 OpenWrt 主营业务同一许可证）。

这意味着你可以自由使用、修改、分发本插件，包括用于商业目的；但如果分发修改后的版本，
**必须以 GPL-2.0 公开相应源码**并保留版权声明。
