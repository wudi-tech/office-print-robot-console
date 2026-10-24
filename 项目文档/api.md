# 前后端通信契约

> 公开归档说明：本文是部署与待集成步骤，不是整机验收记录。仓库包含 Web/PWA、演示 HTTP 服务、ROS2 HTTP 桥接和 USB 打印节点；调度器、Nav2/底盘驱动、真实地图与设备均需另行提供。桥接 API 可达只表示服务连接，CUPS 命令成功只表示打印请求已提交，均不证明导航就绪或纸张已输出。所有工位/地图坐标与用户数据为示例，不能直接用于实机。当前验证见 [验证记录](../docs/VALIDATION.md)。

网页通过 WiFi 访问 RDK X5。建议文件上传和任务下发走 HTTP API，机器人实时状态可以走 HTTP 轮询，也可以走 rosbridge WebSocket 订阅 ROS2 topic。

## HTTP API

默认地址：

```text
http://<RDK_X5_IP>:8080
```

### GET /api/health

用于连接检查。真实 RDK X5 桥接节点必须返回 `name: "print_robot_bridge"`，网页会用它区分桥接服务和本地演示服务；该字段不验证硬件身份或导航就绪。

```json
{
  "ok": true,
  "name": "print_robot_bridge"
}
```

### GET /api/status

返回机器人、打印机和网络状态。

```json
{
  "robot": {
    "state": "delivering",
    "floor": "3F 办公区",
    "location": "产品 C-05",
    "x": 466,
    "y": 330,
    "battery": 82,
    "speed": 0.22
  },
  "printer": {
    "state": "printing",
    "activeJobId": "JOB-123456",
    "queueLength": 3,
    "waitSeconds": 240,
    "progress": 56
  },
  "network": {
    "ip": "192.168.1.20",
    "rssi": -52
  },
  "updatedAt": "2026-05-10T10:00:00.000Z"
}
```

状态枚举：

```text
idle, queued, printing, printing_en_route, navigating_to_target, delivering, awaiting_manual_print, charging, done, canceled, error
```

### GET /api/jobs

返回任务队列。

```json
{
  "jobs": [
    {
      "id": "JOB-123456",
      "fileName": "report.pdf",
      "recipient": "用户1",
      "targetStation": "C-05",
      "targetLabel": "产品 C-05",
      "pickupCode": "839204",
      "status": "queued",
      "progress": 0,
      "printSettings": {
        "copies": 1,
        "pages": "全部",
        "colorMode": "mono",
        "duplex": "duplex",
        "paperSize": "A4",
        "priority": "normal",
        "printMode": "mobile_print"
      },
      "createdAt": "2026-05-10T10:00:00.000Z"
    }
  ]
}
```

### GET /api/floor-config

返回当前楼层地图、工位和 ROS 坐标配置。网页可用它做工位选择，调度节点可用同一份结构做目标点映射。

```json
{
  "id": "office_3f",
  "name": "3F 工位与设备",
  "floor": "3F 办公区",
  "rosMap": {
    "yaml": "",
    "frameId": "map"
  },
  "stations": [
    {
      "id": "C-05",
      "label": "产品 C-05",
      "type": "desk",
      "selectable": true,
      "ui": { "x": 466, "y": 330 },
      "ros": { "x": 4.1, "y": 0.1, "yaw": 1.57 }
    }
  ]
}
```

### POST /api/jobs

使用 `multipart/form-data`，字段如下：

```text
file             PDF/Word/Excel/PPT/TXT 等办公文件
targetStation    目标工位，如 C-05
recipient        接收人姓名或工号
copies           打印份数
pages            全部 或 1-3,8
colorMode        mono | color
duplex           single | duplex
paperSize        A4 | A3 | Letter
priority         normal | high | batch
printMode        mobile_print | manual_at_station
pickupCode       6 位交付码
submittedAt      ISO 时间
```

`printMode` 含义：

```text
mobile_print       车载打印机一边打印，一边随小车前往目标工位
manual_at_station  小车先到目标工位，现场人员再操作车载打印机打印
```

响应：

```json
{
  "ok": true,
  "job": {
    "id": "JOB-123456",
    "fileName": "report.pdf",
    "targetStation": "C-05",
    "status": "queued",
    "progress": 0
  }
}
```

### POST /api/jobs/{job_id}/cancel

取消尚未完成的任务。

```json
{
  "ok": true
}
```

## ROS2 Topic

为了减少自定义接口依赖，示例桥接包使用 `std_msgs/msg/String` 承载 JSON。后续项目稳定后，可以把 JSON 替换为自定义 `.msg`/`.srv`。

### /print_robot/status

类型：`std_msgs/msg/String`

方向：机器人核心节点发布，桥接节点和网页订阅。

`data` 内容与 `GET /api/status` JSON 一致。

### /print_robot/jobs/request

类型：`std_msgs/msg/String`

方向：桥接节点发布，调度节点订阅。

```json
{
  "id": "JOB-123456",
  "filePath": "/tmp/print_robot_uploads/JOB-123456/report.pdf",
  "fileName": "report.pdf",
  "recipient": "用户1",
  "targetStation": "C-05",
  "targetLabel": "产品 C-05",
  "targetPose": { "x": 4.1, "y": 0.1, "yaw": 1.57 },
  "pickupCode": "839204",
  "printSettings": {
    "copies": 1,
    "pages": "全部",
    "colorMode": "mono",
    "duplex": "duplex",
    "paperSize": "A4",
    "priority": "normal",
    "printMode": "mobile_print"
  },
  "submittedAt": "2026-05-10T10:00:00.000Z"
}
```

### /print_robot/jobs/state

类型：`std_msgs/msg/String`

方向：调度节点发布，桥接节点订阅。

可发布单个任务或完整队列：

```json
{
  "job": {
    "id": "JOB-123456",
    "status": "delivering",
    "progress": 78,
    "targetStation": "C-05"
  }
}
```

### /print_robot/printer/request

类型：`std_msgs/msg/String`

方向：调度节点发布，`usb_printer_node` 订阅。

用途：在 `manual_at_station` 模式下，小车到达工位后触发车载 USB 打印机打印。

```json
{
  "id": "JOB-123456",
  "filePath": "/tmp/print_robot_uploads/JOB-123456/report.pdf",
  "force": true,
  "printSettings": {
    "copies": 1,
    "pages": "全部",
    "colorMode": "mono",
    "duplex": "single",
    "paperSize": "A4"
  }
}
```

### /print_robot/printer/state

类型：`std_msgs/msg/String`

方向：`usb_printer_node` 发布。

```json
{
  "jobId": "JOB-123456",
  "state": "printing",
  "message": "Print started from job_request"
}
```

### /print_robot/jobs/cancel

类型：`std_msgs/msg/String`

方向：桥接节点发布，调度节点订阅。

```json
{
  "id": "JOB-123456",
  "requestedAt": "2026-05-10T10:03:00.000Z"
}
```
