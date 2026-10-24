# 办公打印配送机器人操作指南

> 公开归档说明：本文是部署与待集成步骤，不是整机验收记录。仓库包含 Web/PWA、演示 HTTP 服务、ROS2 HTTP 桥接和 USB 打印节点；调度器、Nav2/底盘驱动、真实地图与设备均需另行提供。桥接 API 可达只表示服务连接，CUPS 命令成功只表示打印请求已提交，均不证明导航就绪或纸张已输出。所有工位/地图坐标与用户数据为示例，不能直接用于实机。当前验证见 [验证记录](../docs/VALIDATION.md)。

这组文档把操作指南、接口契约和 ROS2 集成说明放在同一个文件夹里，面向第一次接触 RDK X5、ROS2 和网页部署的同学。建议按顺序阅读和操作，不要跳步。

## 推荐学习顺序

1. [Web 移植指南](./01_Web移植指南.md)
   - 把网页放到 RDK X5 或其他电脑上。
   - 让手机、电脑通过 WiFi 打开打印机器人网页。
   - 学会修改网页连接到 RDK X5 的地址。

2. [RDK X5 ROS2 运行与底盘配合指南](./02_RDK_X5_ROS2运行与底盘配合指南.md)
   - 在已有 ROS2 环境中编译并运行 `print_robot_bridge`。
   - 理解网页任务如何进入 ROS2 topic。
   - 学会让调度节点配合底盘/Nav2 和车载打印机外设。
   - 测试从网页下发任务到小车导航目标点的完整链路。

3. [地图导入和工位配置指南](./03_地图导入和工位配置指南.md)
   - 保存小车建好的真实地图。
   - 把地图放进网页中显示。
   - 用 `/amcl_pose` 记录真实工位坐标。
   - 修改 `office_3f.json`，把工位和 ROS2 导航目标对应起来。

4. [前后端通信契约](./api.md)
   - 查看网页、RDK X5 HTTP API 和 ROS2 topic 的数据格式。
   - 确认真实连接必须返回 `name: "print_robot_bridge"`。

5. [RDK X5 与 ROS2 集成说明](./ros2-integration.md)
   - 查看桥接节点、车载 USB 打印节点和 rosbridge 的集成方式。

## 项目关键目录

```text
web/                                      网页和本地 Web 服务
web/config/office_3f.json                 网页使用的地图和工位配置
web/maps/                                 真实地图图片放这里
ros2_ws/src/print_robot_bridge/           RDK X5 上运行的 ROS2 桥接包
ros2_ws/src/print_robot_bridge/config/office_3f.json
                                          RDK X5/ROS2 使用的工位配置
项目文档/                                 操作指南、接口契约和 ROS2 集成说明
```

## 最小闭环

当你完成三份指南后，系统应该能做到：

1. 用户用手机或电脑打开网页。
2. 用户上传文件、选择打印参数、选择目标工位。
3. 网页通过 WiFi 把任务发给 RDK X5。
4. RDK X5 保存文件，并把任务发布到 ROS2。
5. ROS2 调度节点读取 `targetPose` 和 `printMode`。
6. 小车携带车载打印机前往工位，边走边打印或到达后人工打印。

## 官方参考资料

- RDK X5 官方硬件介绍：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/hardware_introduction/rdk_x5/
- Nav2 Map Saver 官方文档：https://docs.nav2.org/configuration/packages/map_server/configuring-map-saver.html
- Nav2 官方文档：https://docs.nav2.org/
