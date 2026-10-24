# 办公打印配送机器人交互端

Web/PWA 交互软件原型：员工填写打印与配送任务，查看示意地图和队列；ROS2 包提供文件上传、JSON topic 桥接和 USB 打印后端示例。

**当前归档级别：可本地运行的软件原型。** 浏览器与 HTTP 服务均有独立演示状态机；仓库没有任务调度器、Nav2 action 客户端或底盘控制器，不能据此称为已完成端到端打印配送机器人。

## 已有内容与边界

| 模块 | 代码提供的能力 | 验证边界 |
| --- | --- | --- |
| Web/PWA | 打印参数表单、文件选择、工位地图、队列/状态展示、取消与连接守卫 | Node 语法检查、应用逻辑离线测试；未新增浏览器视觉验收 |
| 本地 HTTP demo | 静态页面、health/status/jobs/floor-config、模拟提交和取消 | 实际启动 Node 服务后执行 HTTP smoke；不保存文件、不打印 |
| ROS2 `bridge_node` | HTTP 上传到本机目录，发布任务/取消 topic，接收状态 JSON | Python 语法检查；未运行 ROS2、未执行 colcon 构建 |
| `usb_printer_node` | CUPS `lp` 参数组装、raw USB 写入、打印状态反馈 | Python 语法检查；未连接打印机、未调用真实打印命令 |
| 调度/导航/交付确认 | 接口和部署指南 | 需要另行实现与联调；未包含完整机器人系统 |

健康接口返回 `name: "print_robot_bridge"` 只代表桥接服务可达，界面的“桥接 API 已连接”不表示机器人 ready。打印节点中 `printerStatus: "done"` / `printProgress: 100` 代表后端请求完成：CUPS 接收任务或 raw 字节写入成功，**不证明物理出纸、导航到达或交付完成**。

## 运行本地演示

需要 Node.js 18+，本次实际验证为 Node.js 24.9.0。项目没有 npm 第三方依赖，无需 `npm install`，也没有前端打包步骤。

```bash
npm start
```

访问 `http://localhost:5173`。网页默认“演示模式”，在浏览器内模拟任务；本地 HTTP 服务另外提供相同形状的模拟 API，二者队列互相独立。`/api/health` 返回 `print_robot_demo_server`，不能作为真实桥接服务使用。

```bash
npm run check
npm test
python scripts/check_python.py
```

测试使用临时端口与合成文件内容，不连接 ROS 或打印设备。详细范围和已知限制见 [验证记录](docs/VALIDATION.md)。可用 `PORT` 环境变量修改网页服务端口。

## ROS2 集成入口

ROS2 包位于 [ros2_ws/src/print_robot_bridge](ros2_ws/src/print_robot_bridge)。目标环境需自行准备 ROS2、`rclpy`、`std_msgs`、`ament_index_python`、`colcon`，以及所选打印后端。桥接上传解析使用 Python 标准库 `cgi`，需 Python 3.12 或更早版本；Python 3.13+ 不能直接运行该桥接节点。建议在项目原指南对应的 ROS2 Humble/Python 3.10 环境单独联调，本次未验证该环境。

原部署命令和接口保留在 [项目文档入口](项目文档/README.md)、[HTTP/ROS2 契约](项目文档/api.md)、[集成说明](项目文档/ros2-integration.md)。说明中的 `your_*` 包、示例 IP、目录与坐标均需替换；执行 `robot_print_system.launch.py` 只启动桥接和打印节点，不会启动导航或调度器。

`web/config/office_3f.json` 与 ROS 包中的同名配置需同步维护。工位坐标、路线、用户、文件名和交付码均是合成演示数据；`rosMap.yaml` 留空，真实地图不在归档内。前端折线路径只是示意绘制，不是避障规划结果。

## 工程限制

- 演示服务使用简化 multipart 文本解析和内存队列，缺少完整服务端字段校验、上传大小限制及持久化；仅适合本地受控演示。
- HTTP/ROS2 接口没有认证、权限或 TLS；交付码只作显示字段，没有身份校验或交付确认逻辑。不要接收真实敏感文件或直接暴露到公网。
- 桥接初始状态是占位值；缺少硬件心跳与就绪检查。取消接口只更新桥接内存和发布 topic，打印节点没有订阅取消 topic，不能保证停止已提交的 CUPS/USB 作业。
- 打印节点没有查询 CUPS 最终作业状态或物理传感反馈，也不转换 DOCX/XLSX/PPTX；网页允许选择格式不代表打印后端支持该格式。
- `auto_print_modes=mobile_print` 会直接消费任务 topic；后续调度器应避免重复触发。raw 后端需要设备本身支持输入字节，不能把它当通用文档打印器。
- PWA 包含 manifest 与 service worker；图标清单为空，安装体验和设备兼容性未验证。

## 归档与贡献说明

本仓库保留现有应用代码和技术说明，记录其可核验实现范围。上传归档不代表独立完成整机硬件、底盘、导航、调度或其他团队模块；原 ROS 元数据中的团队字段保留，个人与团队分工未补写。原元数据声明 `Apache-2.0`，但源目录没有完整 LICENSE 文件，本次没有额外补充授权声明。

公开副本的调整、排除项和文件对照见 [归档说明](docs/ARCHIVE.md)。
