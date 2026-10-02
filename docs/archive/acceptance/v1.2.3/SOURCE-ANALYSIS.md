# v1.2.3 开发前源码分析与风险确认

本文件记录开发前已向用户输出的分析与修改边界。

| 页面 / 组件 | 现状与调用关系 | 本次修改 |
| --- | --- | --- |
| src/renderer/main.tsx | nav 数组、条件分支分发页面 | 导航排序和展示文字，删除长视频导入及分支 |
| src/renderer/pages/BatchGenerate.tsx | 原长视频页面 | 删除页面文件；不删除历史记录或后台能力 |
| src/renderer/pages/OneClick.tsx | 左任务列表、中间素材/Prompt、右参数；调用现有 packages.* | 仅标题新增现有 open 接口入口 |
| src/renderer/components/WorkbenchTaskSidebar.tsx | tasks.list 只读轮询，点击 setTask 展示详情 | 统一标题、拖拽调宽、实际时长和创建时间 |
| 新增 OutputVideoDuration.tsx | 已有 aivideo://local/output/{id} 协议访问本地成品 | HTML video preload=metadata 读取实际 duration，无API/协议变更 |
| src/renderer/pages/Generate.tsx | 任务列表读取原任务队列 | 仅任务区标题 |
| src/renderer/pages/Audio.tsx | 原音频批次与历史结果 | 仅任务区标题与展开提示 |
| src/renderer/style.css | 原布局 | 任务列宽度、拖拽柄、换行和响应布局 |

此外仅更新版本标识（package.json、package-lock.json 根版本、VERSION、brand.ts）、测试与交付文档。

风险确认：不修改一键生成输入/分析/Prompt/预检/确认/提交逻辑，不修改任务包协议、Binding、素材引用、服务层、数据库和文件保存路径。新增文件夹按钮复用现有 open({kind:'output'})，由主进程读取当前 settings.outputDir，再 shell.openPath；不硬编码数据根目录。

时长方案：只有本地视频输出可读时才显示元数据的真实秒数；未完成或读取失败明确显示状态，不使用 Prompt、输出配置或累计片段推算。只读元数据，不写数据库。
