# Web 移植指南

> 公开归档说明：本文是部署与待集成步骤，不是整机验收记录。仓库包含 Web/PWA、演示 HTTP 服务、ROS2 HTTP 桥接和 USB 打印节点；调度器、Nav2/底盘驱动、真实地图与设备均需另行提供。桥接 API 可达只表示服务连接，CUPS 命令成功只表示打印请求已提交，均不证明导航就绪或纸张已输出。所有工位/地图坐标与用户数据为示例，不能直接用于实机。当前验证见 [验证记录](../docs/VALIDATION.md)。

目标：让其他人能通过浏览器打开打印机器人网页，并通过 WiFi 连接 RDK X5。

你可以选择两种部署方式：

```text
推荐：网页放在 RDK X5 上，别人访问 http://<RDK_X5_IP>:5173
备选：网页放在你的电脑上，别人访问 http://<电脑IP>:5173
```

对于初学者，推荐把网页放在 RDK X5 上。这样 RDK X5 同时提供网页和机器人接口，使用者不需要关心你的电脑是否开机。

## 1. 需要复制哪些文件

只移植网页，需要复制：

```text
web/
package.json
```

如果你要让 RDK X5 同时运行 ROS2 桥接节点，还需要复制：

```text
ros2_ws/src/print_robot_bridge/
```

不要复制这些：

```text
.git/
artifacts/
node_modules/
server.out.log
server.err.log
__pycache__/
```

## 2. 用 U 盘复制

适合刚开始、不熟悉命令行的情况。

1. 在 Windows 电脑上把项目文件夹复制到 U 盘。
2. 把 U 盘插到 RDK X5。
3. 在 RDK X5 桌面打开文件管理器。
4. 把项目复制到：

```text
/opt/office-print-robot-console
```

这里的 `/opt` 是示例部署目录；可改为你的用户目录，例如：

```text
~/office-print-robot-console
```

## 3. 用 scp 复制

适合 RDK X5 已经联网，并且你知道它的 IP 地址。

先在 RDK X5 上查看 IP：

```bash
hostname -I
```

假设看到：

```text
192.168.1.20
```

在 Windows PowerShell 中进入项目所在目录，然后执行：

```powershell
scp -r web package.json <robot-user>@192.168.1.20:/opt/office-print-robot-console/
```

如果还要复制 ROS2 桥接包：

```powershell
scp -r ros2_ws/src/print_robot_bridge <robot-user>@192.168.1.20:/opt/office-print-robot-console/ros2_ws/src/
```

第一次连接会询问是否信任主机，输入：

```text
yes
```

然后输入 RDK X5 的登录密码。

## 4. 在 RDK X5 上安装 Node.js

网页服务需要 Node.js。

先检查是否已经安装：

```bash
node -v
npm -v
```

如果能显示版本号，例如 `v18.19.0`，说明已经安装。

如果没有安装，可以先尝试：

```bash
sudo apt update
sudo apt install -y nodejs npm
```

安装后再检查：

```bash
node -v
npm -v
```

建议 Node.js 版本为 18 或更高。如果版本太低，网页服务可能无法正常启动。

## 5. 启动网页

进入项目目录：

```bash
cd /opt/office-print-robot-console
```

启动网页：

```bash
npm start
```

如果看到类似输出：

```text
Print robot console: http://localhost:5173
```

说明网页已经启动。

## 6. 让别人访问网页

在 RDK X5 上查看 IP：

```bash
hostname -I
```

假设 IP 是：

```text
192.168.1.20
```

同一个 WiFi 下，其他电脑或手机打开：

```text
http://192.168.1.20:5173
```

注意：

```text
localhost 只代表当前设备自己。
别人访问时不能用 http://localhost:5173，要用 RDK X5 的 IP。
```

## 7. 在网页里连接 RDK X5

打开网页右上角的“连接设置”，填写：

```text
工作模式：RDK X5
HTTP API：http://192.168.1.20:8080
rosbridge WebSocket：ws://192.168.1.20:9090
状态 Topic：/print_robot/status
```

其中：

```text
HTTP API 必填，用于上传文件、下发打印任务、查询状态。
rosbridge WebSocket 可选，用于实时订阅 ROS2 状态。
```

这里一定要注意端口：

```text
5173 是网页服务端口，只负责打开页面。
8080 是 RDK X5 上 ROS2 桥接节点的 HTTP API 端口，负责真实状态和任务下发。
```

真实模式下不要把 HTTP API 填成 `http://192.168.1.20:5173`。网页会检查：

```bash
curl http://192.168.1.20:8080/api/health
```

正常返回应包含：

```json
{
  "ok": true,
  "name": "print_robot_bridge"
}
```

只有检测到这个桥接节点，网页才会显示 桥接 API 已连接，并允许下发真实打印任务。

如果暂时没有启动 ROS2 桥接节点，可以先选择：

```text
工作模式：演示模式
```

## 8. 修改工位和网页地图

网页地图和工位来自：

```text
web/config/office_3f.json
```

常改字段：

```json
{
  "id": "C-05",
  "label": "产品 C-05",
  "selectable": true,
  "ui": { "x": 466, "y": 330 },
  "ros": { "x": 4.1, "y": 0.1, "yaw": 1.57 }
}
```

`ui` 是网页上的显示位置，`ros` 是真实导航位置。只做网页演示时，可以先只改 `label` 和 `ui`。

## 9. 常见问题

### 打不开网页

检查网页服务是否还在运行：

```bash
ps aux | grep node
```

重新启动：

```bash
cd /opt/office-print-robot-console
npm start
```

### 手机访问不了

逐项检查：

```text
手机和 RDK X5 是否在同一个 WiFi
访问地址是否用了 RDK X5 的 IP
端口是不是 5173
RDK X5 是否已经启动 npm start
```

### 网页显示 RDK 离线

说明网页打开了，但 RDK X5 的桥接 API 没连上。检查：

```bash
curl http://127.0.0.1:8080/api/health
```

如果 RDK X5 自己都访问不了，说明 ROS2 桥接节点还没启动。

### 换了 WiFi 后不能连接

RDK X5 的 IP 可能变了。重新查看：

```bash
hostname -I
```

然后在网页“连接设置”里改成新的 IP。
