# MediaRecorder 浏览器编码支持情况

## 为什么需要 fallback 逻辑

浏览器的 MediaRecorder API 支持差异巨大，这是 Web 标准碎片化的典型例子。

## 各浏览器实际支持

### Chrome/Edge (Chromium 内核)
```javascript
MediaRecorder.isTypeSupported('video/mp4;codecs=h264')     // ❌ false
MediaRecorder.isTypeSupported('video/mp4')                 // ❌ false
MediaRecorder.isTypeSupported('video/webm;codecs=vp9')     // ✅ true
MediaRecorder.isTypeSupported('video/webm;codecs=vp8')     // ✅ true
MediaRecorder.isTypeSupported('video/webm;codecs=h264')    // ⚠️ 有限支持
```

**原因**: Chromium 只支持编码到 WebM 容器，MP4 只能解码播放

### Firefox
```javascript
MediaRecorder.isTypeSupported('video/mp4;codecs=h264')     // ❌ false
MediaRecorder.isTypeSupported('video/webm;codecs=vp9')     // ✅ true
MediaRecorder.isTypeSupported('video/webm;codecs=vp8')     // ✅ true
```

**原因**: Firefox 坚持开放标准，不支持专有的 H.264 编码（有专利问题）

### Safari
```javascript
MediaRecorder.isTypeSupported('video/mp4;codecs=h264')     // ✅ true
MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')     // ✅ true
MediaRecorder.isTypeSupported('video/webm')                // ❌ false (旧版)
MediaRecorder.isTypeSupported('video/webm')                // ⚠️ true (新版 macOS 14+)
```

**原因**: Apple 推广自己的 H.264/HEVC 标准，WebM 支持较晚

## 当前实现的兼容性策略

```javascript
// 用户选择 MP4 时的 fallback 链
[
  'video/mp4;codecs=h264',        // Safari 可用
  'video/mp4;codecs=avc1.42E01E', // Safari 备选
  'video/webm;codecs=h264',       // 理论上可行但少见
  'video/webm;codecs=vp9',        // Chrome/Firefox 主力
  'video/webm;codecs=vp8',        // 广泛支持
  'video/webm'                    // 兜底方案
]

// 用户选择 WebM 时的 fallback 链
[
  'video/webm;codecs=vp9',        // 高质量，现代浏览器
  'video/webm;codecs=vp8',        // 兼容性好
  'video/webm'                    // 兜底方案
]
```

## 实际输出结果

| 浏览器 | 用户选择 MP4 | 用户选择 WebM |
|--------|-------------|---------------|
| Chrome | WebM (VP9)  | WebM (VP9)    |
| Firefox| WebM (VP9)  | WebM (VP9)    |
| Safari | MP4 (H.264) | MP4 (H.264)⚠️ |

⚠️ **Safari 在旧版本选择 WebM 会失败**，因为不支持

## 为什么不能强制 MP4

即使用户选择 "MP4 (H.264)"，在 Chrome/Firefox 上实际仍会输出 WebM：

1. **专利问题**: H.264 需要专利授权费用
2. **开放标准**: WebM/VP9 是 Google 推动的免费开放标准
3. **硬件加速**: 各浏览器对不同编码器的硬件加速支持不同

## 推荐做法

✅ **当前实现是最佳实践**:
- 让用户选择偏好格式
- 自动 fallback 到浏览器支持的格式
- 根据实际 mimeType 设置正确的文件扩展名

❌ **不推荐**:
- 强制特定格式（会在某些浏览器失败）
- 不提供 fallback（兼容性差）
- 依赖后端转码（增加复杂度）

## 未来展望

- **WebCodecs API**: 更底层的编解码控制，但需要手动封装
- **WASM 编码器**: FFmpeg.wasm 可以实现任意格式，但性能较差
- **服务端转码**: 最可靠但需要后端基础设施

## 测试命令

在浏览器控制台运行：
```javascript
['video/mp4;codecs=h264', 'video/mp4;codecs=avc1.42E01E', 
 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 
 'video/webm;codecs=vp8', 'video/webm']
 .forEach(mime => 
   console.log(mime, MediaRecorder.isTypeSupported(mime))
 );
```
