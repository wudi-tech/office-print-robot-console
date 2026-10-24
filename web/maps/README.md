# 地图图片

把 ROS2 保存得到的 `office_3f.pgm` 转成 PNG 后放到这里，例如：

```text
web/maps/office_3f.png
```

然后修改：

```text
web/config/office_3f.json
```

把 `uiMap.image` 改成：

```json
"./maps/office_3f.png"
```

网页会用真实地图图片替换当前的示意 SVG 底图，工位点仍然从配置文件里的 `stations[].ui` 坐标读取。
