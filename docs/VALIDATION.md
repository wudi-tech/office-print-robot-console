# 验证记录

验证日期：2026-10-25。环境：Windows、Node.js 24.9.0；Python 3.13.9 仅用于源码解析。没有连接 ROS、底盘、RDK X5 或打印设备，没有执行打印命令。

## 已执行

| 检查 | 结果 | 能证明什么 |
| --- | --- | --- |
| `npm run check` | PASS | `app.js`、`server.mjs`、`sw.js` 语法有效 |
| `npm test` | 4/4 PASS | 实际 HTTP 服务与三组应用逻辑错误/离线检查通过 |
| `python scripts/check_python.py` | PASS，8 个 Python 文件 | ROS 节点、launch、setup 与检查脚本的 AST 语法有效；不导入 ROS |
| JSON、XML 与相对 Markdown 链接 | PASS | 配置可解析、两份楼层配置一致、引用的本地文件存在 |
| 公开文件审计 | PASS | 已审查发布文件；没有纳入上传内容、环境、缓存、运行日志或命中的凭据模式 |

## HTTP smoke 范围

测试自动启动真实 `web/server.mjs` 子进程，分配临时本地端口，结束后关闭服务：

- 静态首页、JS、CSS、service worker、manifest 与图标可访问。
- health 明确返回 `print_robot_demo_server` 和 `demo: true`。
- status、jobs 和 floor-config 返回预期结构，初始队列是合成演示数据。
- 使用内存生成的 `synthetic-demo.txt` 合成内容，真实 multipart POST 创建队列任务，核对目标、打印参数、UI/ROS 示例坐标。
- 取消已提交任务后为 `canceled`；不存在的任务返回 `ok: false`；未知路径为 HTTP 404；OPTIONS 为 204。

这里的 HTTP demo 不保存文件、不执行打印。它与网页默认 mock 模式的内存队列相互独立。上传接口仍是简化演示实现，不覆盖异常大文件、恶意输入或生产安全要求。

## 应用离线逻辑范围

测试在 Node VM 中执行实际 `web/app.js`，仅跳过自动 `init()`，使用最小 DOM 替身：

1. 把本地 demo 的 health 当作桥接地址时，前端拒绝身份字段、清空旧任务并锁定真实提交。
2. 本地不可访问地址导致 fetch 失败时，清空位置/电量/网络占位数据，显示离线；真实提交与取消都返回离线提示。
3. health 成功但 status/jobs 返回错误时，连接仍为离线并锁定提交。

这是应用逻辑验证；没有把 VM 替身测试描述为浏览器视觉验收。历史截图未用于证明本次运行。

## 未验证与剩余工作

- 未执行 `colcon build`，未导入/启动 ROS2 节点，未确认 launch 参数在目标 ROS 发行版的运行行为。
- 本机 Python launcher 的 3.12 注册项所指解释器不存在，没有把它计为已执行的兼容性验证。
- 桥接使用 `cgi`，Python 3.13+ 缺少该标准库模块，必须选兼容版本或另行迁移上传解析器。
- 未验证 rosbridge、ROS topic 传输、RDK 板卡、地图定位、导航、调度、移动中打印、USB/CUPS 或物理出纸。
- 没有任务调度器/Nav2 控制器。桥接默认状态不是硬件心跳；health 可达不代表机器人就绪。
- 打印后端成功仅说明请求/字节提交，取消 topic 没有在打印节点中消费。最终出纸、取消正在打印的任务和交付确认需要额外实现与实测。
- 前端没有独立构建过程，不能把语法与 HTTP 检查称为打包构建或实机验收。
