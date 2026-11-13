# src/mobile

预留的手机端目录（**一期为空**）。

依据 `docs/requirements.md` §4 与决策记录 4：手机端复用策略为「性能优先，可接受双端两套代码」。
一期只上线 Web；若 WebView 渲染性能不达标，在此目录另起原生实现，仅复用
`src/app/packages/` 下的模型/数据层（design-model、catalog、bom、safety-rules、editor-state
均为无渲染依赖的纯逻辑包，可直接供原生壳/JS 引擎消费）。

渲染层边界见 `apps/web/src/components/Viewer3D.tsx`（渲染层通过抽象与状态层通信）。
