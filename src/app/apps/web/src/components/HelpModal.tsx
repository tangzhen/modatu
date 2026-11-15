import { IconClose } from './icons';

/**
 * 使用说明弹窗（右上角 ？ 入口）。
 * 主界面不再放置说明文字，操作指引集中在本文档；Edge 鼠标手势的关闭方法见 Q&A。
 */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal help-modal"
        role="dialog"
        aria-label="使用说明"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>使用说明</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="help-body">
          <h4>快速上手</h4>
          <ol className="help-steps">
            <li>
              点击左侧工具轨 <b>型材库</b> 图标，搜索或在系列分类中找到规格，点击规格卡片进入放置模式。
            </li>
            <li>
              画布内鼠标跟随 ghost，<b>按住拖拽</b>定长后松手创建（立柱向上拖延长）；可连续放置，<kbd className="kbd">Esc</kbd> 或右键退出。
            </li>
            <li>
              点击部件选中：拖动沿地面移动（<kbd className="kbd">Shift</kbd>+拖动调高度）；选中型材拖端部箭头调长，颜色在右侧属性面板更换。
            </li>
            <li>
              工具栏：清单（BOM）导出采购清单，AI 面板用自然语言生成/修改设计，适配视图回到默认机位。
            </li>
          </ol>

          <h4>视图操作</h4>
          <p className="hint">
            左键拖拽旋转视角 · <b>中键拖拽平移</b> · 滚轮缩放。双击设计名可重命名，编辑后自动保存到云端。
          </p>

          <h4>快捷键</h4>
          <p className="hint">
            按 <kbd className="kbd">F2</kbd> 显示/隐藏快捷键速查表（带按键徽章）。
          </p>

          <h4>Q&amp;A：Edge 浏览器的鼠标手势抢占了右键拖拽 / 误触返回？</h4>
          <p className="hint">
            Edge 的鼠标手势在浏览器层拦截右键拖拽，网页无法通过代码禁用。解决方法：
          </p>
          <ol className="help-steps">
            <li>
              打开 Edge 地址栏输入 <code>edge://settings/mouseGesture</code>，关闭「启用鼠标手势」。
            </li>
            <li>若你的 Edge 版本在手势设置中提供「网站排除」列表，可将木搭图加入排除。</li>
            <li>
              企业/学校电脑可联系管理员通过策略 <code>MouseGestureEnabled</code> 统一关闭。
            </li>
            <li>本站视图平移已支持<b>中键拖拽</b>（Fusion 360 惯例），不经过右键，不受手势影响。</li>
          </ol>

          <h4>Q&amp;A：数据会丢失吗？</h4>
          <p className="hint">
            登录后编辑自动保存并生成版本历史，可随时回退；游客模式的编辑仅存于本页，存在未保存编辑时会拦截误触导航（含手势返回）并确认。
          </p>
        </div>
      </div>
    </div>
  );
}
