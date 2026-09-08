# 高斯查看器（point_wlbwg）搭建说明

## 一、做了什么

在工作区 `D:\lm\w` 里搭了一个最小可运行的 3D 高斯查看器，用官方 **@playcanvas/supersplat-viewer 1.28.0** 加载 `data/point_wlbwg.compressed.ply`（148 MB，912 万 splat）。

| 文件 | 作用 |
| --- | --- |
| `package.json` | 依赖 `@playcanvas/supersplat-viewer@1.28.0`，脚本 build / serve |
| `scripts/build.mjs` | 复制官方 `public/` 三件套到 `dist/`，并打 5 处补丁（见下） |
| `scripts/serve.mjs` | 零依赖静态服务器：伺服 `dist/`，并把 `/data/*` 直接映射到项目根 `data/`（**148MB ply 零拷贝，不复制进 dist**），支持 Range 请求 |
| `settings.json` | 查看器设置（深色背景、无动画轨道、无后处理、自动取景） |
| `dist/` | 构建产物（`index.html` / `index.js` / `index.css` / `settings.json`） |
| `start.bat` | 一键：构建 + 启动服务（默认 8123 端口） |

### 打的补丁（全部严格校验：目标片段必须恰好出现 1 次）

1. **index.html-注入早期参数解析脚本**：官方脚本执行前读 `?flip=1` / `?rot=x,y,z`；
2. **index.html-标题** → 「高斯查看器 - point_wlbwg」；
3. **index.html-品牌区文案** → 「高斯查看器」；
4. **index.html-空 favicon**：消除 favicon.ico 404；
5. **index.html-默认 contentUrl** → `./data/point_wlbwg.compressed.ply`（官方默认 `./scene.compressed.ply` 必 404）；
6. **index.js-坐标系旋转可配置**：官方固定 `setLocalEulerAngles(0, 0, 180)`，改成按 URL 参数决定（默认保持官方值）；
7. **index.js-删除默认自动旋转/巡游动画**：官方会对包围盒外的场景自动生成绕圈/8字相机轨道并默认播放（观感=打开后自动转圈），改为默认静态展示（返回 null）；`?anim=1` 可恢复官方自动转圈。
8. **index.js-?coldbg=1 自动开碰撞高亮**：核对碰撞体与画面是否贴合；
9. **index.js-有碰撞时默认 walk/fly 模式**：官方对"物体在包围盒外"强制 orbit（无碰撞），改为有碰撞数据时进入带碰撞的第一人称模式（`?mode=` 可强制）。

> 注：碰撞默认关闭，需 URL 加 `?collision=./data/point_wlbwg.voxel.json`（曾设默认加载，2026-09-05 已取消）。

## 二、数据情况

`data/point_wlbwg.compressed.ply`

- 生成工具：splat-transform 3.3.3
- 格式：PlayCanvas **compressed PLY**（viewer 原生支持，官方默认加载的也是 `scene.compressed.ply`）
- 规模：`element vertex 9126581`（912 万 splat）、`element chunk 35651`、文件 148,592,829 字节
- vertex 属性：`packed_position` / `packed_rotation` / `packed_scale` / `packed_color`

### 场景包围盒（从 chunk 元数据算出）

| 项 | X | Y | Z |
| --- | --- | --- | --- |
| min | -51.17 | -73.74 | -10.42 |
| max | 38.18 | 17.08 | 23.68 |
| 跨度 | 89.35 | 90.82 | **34.10** |

中心 `(-6.49, -28.33, 6.63)`。**Z 方向跨度最小（34.1），X/Y 都接近 90** —— 如果场景是水平铺开的场地/建筑群，那 Z 就是"高度"轴，说明数据是 **Z-up**，需要用 `?flip=1` 转成 Y-up；如果它本身就是竖直向的物体（塔、山体），官方默认朝向就对了。两种都试一下，一眼就能分辨。

> 912 万 splat 属于超大规模，首次加载需要几十秒到几分钟（取决于 GPU/内存），期间浏览器会占较大内存。

## 三、访问方式

服务已在运行：**http://127.0.0.1:8123/**

| 地址 | 说明 |
| --- | --- |
| http://127.0.0.1:8123/ | 默认 WebGPU + 官方朝向 |
| http://127.0.0.1:8123/?webgl=1 | **WebGL 回退**，预览面板或显卡不支持 WebGPU 时用 |
| http://127.0.0.1:8123/?webgl=1&flip=1 | WebGL + **Z-up 转 Y-up**（绕 X 轴 -90°），场景躺倒时用 |
| http://127.0.0.1:8123/?rot=0,0,0 | 完全不旋转（自定义欧拉角，调试用） |
| http://127.0.0.1:8123/?budget=3000000 | 限制同时渲染的 splat 数（卡顿/内存不足时降数量） |
| http://127.0.0.1:8123/?anim=1 | 恢复官方自动绕圈/巡游动画（**默认已删除**：加载后静态展示，鼠标拖拽旋转、滚轮缩放） |
| http://127.0.0.1:8123/?content=./data/xxx.ply | 换文件（新 ply 丢进 `data/` 即可，无需重新构建） |
| http://127.0.0.1:8123/?ministats=1 | 显示帧率 / splat 数性能面板 |
| http://127.0.0.1:8123/?coldbg=1 | 自动打开碰撞高亮（需配合 ?collision=；也可点右下 Show Collision） |
| http://127.0.0.1:8123/?mode=fly | 强制相机模式（orbit=轨道 / fly=自由飞行 / walk=第一人称；有碰撞数据时 fly/walk 才带碰撞） |
| http://127.0.0.1:8123/?collision=./data/point_wlbwg.voxel.json | **手动启用碰撞**（默认已关闭；启用后自动进 walk/fly 带碰撞模式） |

参数可叠加，例如 `?webgl=1&flip=1&budget=3000000`。
重启服务：`start.bat`（或 `node scripts/serve.mjs 8123`）。改了 `settings.json` 后执行 `node scripts/build.mjs` 重新同步。

## 四、碰撞数据（默认关闭，?collision= 启用）

默认**关闭**。浏览器打开是普通浏览（相机出生在 `settings.json` 的室内出生点）；URL 加 `?collision=./data/point_wlbwg.voxel.json` 即启用碰撞并自动进入第一人称行走模式（WASD 移动 + 鼠标转头 + 空格跳），**碰撞体保证不穿模**。

| 文件 | 说明 |
| --- | --- |
| `data/point_wlbwg.voxel.json` + `.voxel.bin` | 稀疏八叉树碰撞体（viewer 实际碰撞检测用） |
| `data/point_wlbwg.collision.glb` | 碰撞可视化网格（Show Collision 高亮 / WebGL 调试用） |

### 生成命令（splat-transform v3.3.0，RTX 3060 ~25s）
```
splat-transform data/point_wlbwg.compressed.ply -r 90,0,0 --voxel-size 0.5 --voxel-external-fill --seed-pos 0,2,25 --collision-mesh faces -g 1 -w data/point_wlbwg.voxel.json
```
- **`-r 90,0,0` 是关键**：voxel 输出 frame = 数据绕 Z 转 180°；而 viewer 默认把 splat 实体绕 X 转 -90° 立起。生成前把源数据绕 X 预转 +90°，输出即与渲染画面逐点对齐（探针验证：probe1→probe2 恰为 Rx(+90) 关系）。
- **`--voxel-external-fill`**：室内场景密封 —— 把包围盒外部填实、只留密闭内部空腔（相机进不去"实心"，也不会穿墙漏到室外）。`--seed-pos` 必须是室内空腔内的点（若该点从外部可达，fill 会自动跳过）。
- 体素 `0.5m`（墙体细节够用）；要更精细可降 `--voxel-size 0.3/0.25`（文件与耗时略增）。
- 换新场景（另一份 ply）：把上述命令换输入文件 + 重新确认 seed 点即可，**无需改 viewer 代码**。

### 相关代码改动（build.mjs 补丁）
- H6：默认 `collisionUrl` → `./data/point_wlbwg.voxel.json`；
- J4：`?coldbg=1` 自动开碰撞高亮（对齐调试）；
- J5：有碰撞数据时默认模式 = walk（大场景）/ fly（小场景），替代官方"物体在包围盒外必 orbit（无碰撞）"。
- `settings.json` 设 `cameras[0].initial` = 室内出生点 `(0,2,25)`（该点即 fill 的 seed，必在室内空腔；y=2 若高于地坪，WalkController 会自动下落落地，无需精确贴地）。

## 五、后续可选项

1. **定死朝向**：确认哪种对之后告诉我，我把默认值写死，就不用带参数了。
2. **出生点/机位**：想换第一人称出生位置，把 `settings.json` 里 `cameras[0].initial.position` 改成新坐标（然后 `node scripts/build.mjs` 重新同步）。
3. **性能**：912 万点建议先用 `?budget=3000000` 试；网页端要流畅的话，用 splat-transform 再降一档（如 300 万点）另存一份。
4. `data/lx.geojson`（9 KB）目前只做静态托管，未接入场景；需要的话可以做路线/标注叠加。
