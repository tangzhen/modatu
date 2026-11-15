import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Axis, DesignModel, Vec3 } from '@modatu/design-model';
import type { CatalogSnapshot, ProfileSpec } from '@modatu/catalog';
import { findFinish } from '@modatu/catalog';
import type { PlacementState } from '../stores/editor';
import {
  getProfileGeometry,
  orientationAxis,
  orientationQuaternion,
  profileWorldDims,
} from './profile-geometry';

/**
 * 渲染层（spec-04 架构决策）：只消费模型状态绘制场景 + 把拾取/拖拽事件转回部件操作。
 * 不包含任何编辑逻辑；mm → 场景单位 1:1。
 *
 * 交互（CAD 式）：
 * - 点击选择；按住部件沿地面拖动（10mm 吸附），Shift+拖动沿竖直方向调整高度；
 * - 选中型材两端出现箭头手柄，拖动调长（10mm 吸附、规格范围钳制、另一端锚定）；
 * - 快捷键：[ / ] 调长 ±10mm，方向键移动 XZ，PageUp/Down 调高度；
 * - ghost 放置模式（placement 非空）：鼠标跟随短型材，按住拖拽定长松手创建；
 *   长度默认 10mm 步进，按住 Shift 丝滑 1mm 步进；Esc / 右键退出放置。
 * - 空白处拖动 = OrbitControls 旋转视角（拖拽部件/手柄期间自动禁用）。
 */

export interface Viewer3DProps {
  model: DesignModel;
  catalog: CatalogSnapshot;
  /** 多选集合（Shift+点击追加） */
  selectedIds: string[];
  /** 点击选择；additive = Shift 多选切换 */
  onSelect: (id: string | null, additive?: boolean) => void;
  /** 统一移动（含 Y）：x/y/z 为新的 min-corner */
  onMove: (id: string, position: { x: number; y: number; z: number }) => void;
  /** 多部件统一移动（多选拖拽 / 对齐后由 store 走 moveParts，单条撤销） */
  onMoveMany: (updates: Array<{ id: string; position: { x: number; y: number; z: number } }>) => void;
  /** 调长并锚定另一端：cutLength + 新 min-corner（一次手势一条撤销记录） */
  onResize: (id: string, cutLength: number, position: { x: number; y: number; z: number }) => void;
  /** ghost 放置模式（来自 store；null = 关闭） */
  placement?: PlacementState | null;
  /** ghost 拖拽完成 → 创建部件（保持放置模式可连续放置） */
  onPlaceProfile?: (input: { specCode: string; orientation: Axis; cutLength: number; position: Vec3 }) => void;
  /** Esc / 右键退出放置模式 */
  onCancelPlacement?: () => void;
  /** 右键 context 菜单（多选 ≥2 且非拖拽时触发；坐标为 client 像素） */
  onContextMenu?: (pos: { x: number; y: number }) => void;
}

const SNAP_MM = 10;
/** ghost 未拖拽时的默认短型材长度（mm） */
const GHOST_DEFAULT_LENGTH = 300;
const PROFILE_COLOR = 0xb9c1c9;
const PROFILE_SELECTED_COLOR = 0xd7e0ea;
const PANEL_COLOR = 0xc98d5a;
const PANEL_SELECTED_COLOR = 0xdfae7e;
const EDGE_COLOR = 0x2f6fed;
const HANDLE_COLOR = 0x2f6fed;

/** 颜色 → 材质缓存（本色/黑色/白色/原木色等各一份 PBR 材质，按 finish.colorHex 复用） */
const finishMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
function getFinishMaterial(colorHex: string | undefined, selected: boolean): THREE.MeshStandardMaterial {
  const base = colorHex ?? '#b9c1c9';
  const key = `${base}:${selected ? 's' : 'n'}`;
  let m = finishMaterialCache.get(key);
  if (!m) {
    const color = new THREE.Color(base);
    if (selected) color.offsetHSL(0, 0, 0.06);
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.85,
      roughness: 0.38,
      ...(selected ? { emissive: 0x0d2b4f, emissiveIntensity: 0.55 } : {}),
    });
    finishMaterialCache.set(key, m);
  }
  return m;
}

const aluminumMaterial = new THREE.MeshStandardMaterial({
  color: PROFILE_COLOR,
  metalness: 0.85,
  roughness: 0.38,
});
const aluminumSelectedMaterial = new THREE.MeshStandardMaterial({
  color: PROFILE_SELECTED_COLOR,
  metalness: 0.85,
  roughness: 0.38,
  emissive: 0x0d2b4f,
  emissiveIntensity: 0.55,
});
/** ghost 半透明材质（放置预览） */
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: PROFILE_COLOR,
  metalness: 0.6,
  roughness: 0.45,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
const panelMaterial = new THREE.MeshStandardMaterial({
  color: PANEL_COLOR,
  metalness: 0.05,
  roughness: 0.72,
});
const panelSelectedMaterial = new THREE.MeshStandardMaterial({
  color: PANEL_SELECTED_COLOR,
  metalness: 0.05,
  roughness: 0.72,
  emissive: 0x4a2c05,
  emissiveIntensity: 0.45,
});
const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
const handleMaterial = new THREE.MeshStandardMaterial({
  color: HANDLE_COLOR,
  metalness: 0.3,
  roughness: 0.35,
});
const handleGeometry = new THREE.ConeGeometry(16, 40, 24);

type PartRecord = {
  mesh: THREE.Mesh;
  kind: 'profile' | 'panel';
  spec?: ProfileSpec;
  orientation: 'x' | 'y' | 'z';
  cutLength: number;
  dims: [number, number, number];
  quaternion: THREE.Quaternion;
};

function findSpec(catalog: CatalogSnapshot, code: string): ProfileSpec | undefined {
  return catalog.profiles.find((s) => s.code === code);
}

export interface Viewer3DHandle {
  /** 相机与视角回到默认机位（工具栏「适配视图」） */
  resetView: () => void;
}

export const Viewer3D = forwardRef<Viewer3DHandle, Viewer3DProps>(function Viewer3D(
  { model, catalog, selectedIds, onSelect, onMove, onMoveMany, onResize, placement, onPlaceProfile, onCancelPlacement, onContextMenu },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => {});
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    partGroup: THREE.Group;
    handleGroup: THREE.Group;
    ghostGroup: THREE.Group;
    /** 当前 ghost 网格（放置模式专用；null = 无） */
    ghostMesh: THREE.Mesh | null;
    /** 按需渲染：场景内容变化时置脏，下一帧渲染一次 */
    invalidate: () => void;
  } | null>(null);
  const propsRef = useRef({ model, catalog, selectedIds, onSelect, onMove, onMoveMany, onResize, placement, onPlaceProfile, onCancelPlacement, onContextMenu });
  propsRef.current = { model, catalog, selectedIds, onSelect, onMove, onMoveMany, onResize, placement, onPlaceProfile, onCancelPlacement, onContextMenu };

  /* --------------------------- 场景初始化（一次性） --------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
    const initialCameraPos = new THREE.Vector3(2500, 2000, 2500);
    camera.position.copy(initialCameraPos);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Edge 原生鼠标手势默认占用右键拖拽（浏览器层拦截，页面无法禁用，见 docs/terminology 之交互约定）：
    // 平移同时映射到中键拖拽（CAD 惯例），右键保留平移以兼容未开手势的浏览器。
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    const raycaster = new THREE.Raycaster();
    const partGroup = new THREE.Group();
    const handleGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    scene.add(partGroup);
    scene.add(handleGroup);
    scene.add(ghostGroup);

    // 按需渲染（CAD 式）：只有场景/相机真正变化时才渲染一帧，空闲 CPU 归零。
    let needsRender = true;
    const invalidate = () => {
      needsRender = true;
    };

    // PBR 环境光照（程序化 RoomEnvironment，零贴图文件）
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 地面栅格 + 补充平行光（环境贴图之外再给一点方向性明暗）
    const grid = new THREE.GridHelper(4000, 40, 0xb0b8c0, 0xd8dee4);
    scene.add(grid);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2000, 3000, 1500);
    scene.add(dir);

    sceneRef.current = { scene, camera, renderer, controls, raycaster, partGroup, handleGroup, ghostGroup, ghostMesh: null, invalidate };

    // 相机变化（交互/阻尼衰减）→ 下一帧渲染
    controls.addEventListener('change', invalidate);

    resetViewRef.current = () => {
      camera.position.copy(initialCameraPos);
      controls.target.set(0, 0, 0);
      controls.update();
      invalidate();
    };

    /** ghost 位置/长度更新（min-corner 语义：anchor = 截面在地面上的最小角点） */
    const placeGhost = (orientation: 'x' | 'y' | 'z', anchor: THREE.Vector3, length: number) => {
      const mesh = sceneRef.current?.ghostMesh;
      const specCode = propsRef.current.placement?.specCode;
      if (!mesh || !specCode) return;
      const spec = findSpec(propsRef.current.catalog, specCode);
      const dims = profileWorldDims(spec, length, orientation);
      mesh.scale.z = length;
      mesh.quaternion.copy(orientationQuaternion(orientation));
      mesh.position.set(anchor.x + dims[0] / 2, anchor.y + dims[1] / 2, anchor.z + dims[2] / 2);
      mesh.visible = true;
      invalidate();
    };

    const resize = () => {
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      // 更新 CSS 尺寸（默认 updateStyle=true）：canvas 显示尺寸严格等于容器尺寸，
      // 否则高分屏下 canvas 按 drawingbuffer 尺寸显示（dpr 倍），取景与指针映射错位。
      renderer.setSize(w, h);
      // 高分屏（4K + 200% 缩放等）限制 pixelRatio，避免 MSAA 全分辨率渲染的 GPU/CPU 开销失控
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      // update() 在阻尼/惯性衰减期间返回 true；收敛后返回 false → 停止渲染
      const cameraMoving = controls.update();
      if (cameraMoving || needsRender) {
        needsRender = false;
        renderer.render(scene, camera);
      }
    };
    animate();

    /* ------------------------- 拾取与拖拽（移动/调长/放置） ------------------------- */
    type DragState =
      | {
          kind: 'move';
          id: string;
          grabDX: number;
          grabDZ: number;
          /** 多选组内各部件拖拽前的 min-corner（组移动用） */
          originals: Map<string, { x: number; y: number; z: number }>;
          /** 吸附参照：未选中部件的世界包围盒 */
          others: Array<{ min: THREE.Vector3; max: THREE.Vector3 }>;
          /** 被抓取部件的世界包围盒（吸附边计算） */
          grabbedBox: THREE.Box3;
        }
      | {
          kind: 'resize';
          id: string;
          /** 'min' = 拖最小端手柄（锚定最大端）；'max' = 拖最大端（锚定最小端） */
          which: 'min' | 'max';
          axis: THREE.Vector3;
          /** 轴线参考点：原最小端截面中心（世界系） */
          lineOrigin: THREE.Vector3;
          origLength: number;
          origAxisPos: number;
          origPosition: { x: number; y: number; z: number };
          minCut: number;
          maxCut: number;
          /** 抓取瞬间的轴线投影参数（消除手柄外置 22mm 的抓取跳变） */
          t0: number;
        }
      | {
          /** ghost 放置拖拽：锚定 min-corner，沿挤出轴定长 */
          kind: 'place';
          anchor: THREE.Vector3;
          axis: THREE.Vector3;
          origLength: number;
          minCut: number;
          maxCut: number;
          t0: number;
        };
    let drag: DragState | null = null;
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    /** 地面点吸附（默认 10mm 栅格；Shift = 丝滑 1mm） */
    const snapGround = (p: THREE.Vector3, fine: boolean): THREE.Vector3 => {
      const s = fine ? 1 : SNAP_MM;
      return new THREE.Vector3(Math.round(p.x / s) * s, 0, Math.round(p.z / s) * s);
    };

    /** 部件间吸附容差（mm）与对齐辅助线 */
    const PART_SNAP_TOL = 8;
    const guideMaterial = new THREE.LineBasicMaterial({ color: 0x0d99ff, transparent: true, opacity: 0.9 });
    const mkGuide = () => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(g, guideMaterial);
      l.visible = false;
      scene.add(l);
      return l;
    };
    const guideX = mkGuide(); // X 对齐：x=coord 的竖直辅助线（沿 Z）
    const guideZ = mkGuide(); // Z 对齐：z=coord 的竖直辅助线（沿 X）
    const guideY = mkGuide(); // Y 对齐：高度处的水平辅助线
    const showGuide = (line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
      line.geometry.setFromPoints([a, b]);
      line.visible = true;
      invalidate();
    };
    const hideGuides = () => {
      guideX.visible = false;
      guideZ.visible = false;
      guideY.visible = false;
    };
    /** 把移动边吸附到候选边（其他部件的边/中心）：返回新的 origin，无命中返回 null */
    const snapOrigin = (proposed: number, movingEdges: number[], targets: number[]): number | null => {
      let origin: number | null = null;
      let bestD = PART_SNAP_TOL;
      for (const e of movingEdges) {
        for (const t of targets) {
          const d = Math.abs(t - e);
          if (d <= bestD) {
            bestD = d;
            origin = proposed + (t - e);
          }
        }
      }
      return origin;
    };
    const edgeTargets = (o: { min: THREE.Vector3; max: THREE.Vector3 }, axis: 'x' | 'y' | 'z'): number[] => {
      const a = o.min[axis];
      const b = o.max[axis];
      return [a, b, (a + b) / 2];
    };

    /** 指针射线在轴线（lineOrigin + axis·t）上的最近点参数 */
    const axisProjection = (event: PointerEvent, lineOrigin: THREE.Vector3, axis: THREE.Vector3): number | null => {
      raycaster.setFromCamera(ndc(event), camera);
      const w0 = new THREE.Vector3().subVectors(lineOrigin, raycaster.ray.origin);
      const B = raycaster.ray.direction.dot(axis);
      const D = raycaster.ray.direction.dot(w0);
      const E = axis.dot(w0);
      const denom = 1 - B * B;
      if (Math.abs(denom) < 1e-6) return null;
      return (B * D - E) / denom;
    };

    const ndc = (event: PointerEvent | MouseEvent): THREE.Vector2 => {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const groundPoint = (event: PointerEvent): THREE.Vector3 | null => {
      raycaster.setFromCamera(ndc(event), camera);
      const p = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
    };
    const currentPart = (id: string): PartRecord | undefined => {
      const mesh = sceneRef.current?.partGroup.children.find((m) => m.userData['partId'] === id) as
        | THREE.Mesh
        | undefined;
      return mesh?.userData['record'] as PartRecord | undefined;
    };

    let rightDown: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      if (event.button === 2) rightDown = { x: event.clientX, y: event.clientY };
      // 0) ghost 放置模式：右键退出；左键开始放置拖拽（不选择部件）
      const placementNow = propsRef.current.placement;
      if (placementNow) {
        if (event.button === 2) {
          propsRef.current.onCancelPlacement?.();
          return;
        }
        if (event.button === 0) {
          const spec = findSpec(propsRef.current.catalog, placementNow.specCode);
          const g = groundPoint(event);
          if (spec && g) {
            const anchor = snapGround(g, event.shiftKey);
            const { axis } = orientationAxis(placementNow.orientation);
            const t0 = axisProjection(event, anchor, axis) ?? 0;
            drag = {
              kind: 'place',
              anchor,
              axis: axis.clone(),
              origLength: Math.max(GHOST_DEFAULT_LENGTH, spec.minCutLength),
              minCut: spec.minCutLength,
              maxCut: spec.maxCutLength,
              t0,
            };
            controls.enabled = false;
            placeGhost(placementNow.orientation, anchor, Math.max(GHOST_DEFAULT_LENGTH, spec.minCutLength));
          }
          return;
        }
      }
      if (event.button !== 0) return; // 仅左键选择/拖拽，右键留给视角
      raycaster.setFromCamera(ndc(event), camera);
      // 1) 调长手柄
      const handleHits = raycaster.intersectObjects(ctx.handleGroup.children, false);
      if (handleHits.length > 0) {
        const info = handleHits[0].object.userData as { partId: string; which: 'min' | 'max' };
        const record = currentPart(info.partId);
        if (record) {
          const { axis } = orientationAxis(record.orientation);
          const dims = record.dims;
          const pos = record.mesh.userData['minCorner'] as { x: number; y: number; z: number };
          const center = new THREE.Vector3(
            pos.x + dims[0] / 2,
            pos.y + dims[1] / 2,
            pos.z + dims[2] / 2,
          );
          const axisIdx = axis.x !== 0 ? 'x' : axis.y !== 0 ? 'y' : 'z';
          const spec = record.spec;
          const lineOrigin = center.clone().sub(axis.clone().multiplyScalar(record.cutLength / 2));
          const t0 = axisProjection(event, lineOrigin, axis);
          if (t0 === null) return;
          drag = {
            kind: 'resize',
            id: info.partId,
            which: info.which,
            axis: axis.clone(),
            lineOrigin,
            origLength: record.cutLength,
            origAxisPos: pos[axisIdx],
            origPosition: { ...pos },
            minCut: spec?.minCutLength ?? 20,
            maxCut: spec?.maxCutLength ?? 3000,
            t0,
          };
          controls.enabled = false;
          return;
        }
      }
      // 2) 部件：Shift = 多选切换；点击已选部件（多选时）保持整组拖动；普通点击单选
      const hits = raycaster.intersectObjects(ctx.partGroup.children, false);
      const hit = hits[0];
      const id = hit ? ((hit.object.userData['partId'] as string) ?? null) : null;
      if (id && event.shiftKey) {
        propsRef.current.onSelect(id, true);
        return;
      }
      const selection = propsRef.current.selectedIds;
      const groupMove = id !== null && selection.includes(id) && selection.length > 1;
      if (id && !groupMove) propsRef.current.onSelect(id);
      const moveIds = groupMove ? selection : id ? [id] : [];
      if (id) {
        const record = currentPart(id);
        const g = groundPoint(event);
        if (record && g) {
          const originals = new Map<string, { x: number; y: number; z: number }>();
          for (const pid of moveIds) {
            const rec = currentPart(pid);
            if (rec) {
              originals.set(pid, { ...(rec.mesh.userData['minCorner'] as { x: number; y: number; z: number }) });
            }
          }
          const grabbed = originals.get(id);
          if (grabbed) {
            const selSet = new Set(moveIds);
            const others: Array<{ min: THREE.Vector3; max: THREE.Vector3 }> = [];
            for (const child of ctx.partGroup.children) {
              const pid = child.userData['partId'] as string;
              if (!pid || selSet.has(pid)) continue;
              others.push(new THREE.Box3().setFromObject(child));
            }
            drag = {
              kind: 'move',
              id,
              grabDX: g.x - grabbed.x,
              grabDZ: g.z - grabbed.z,
              originals,
              others,
              grabbedBox: new THREE.Box3().setFromObject(record.mesh),
            };
            controls.enabled = false;
          }
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      // 放置模式悬停：ghost 跟随鼠标（未拖拽时保持默认短型材长度）
      if (!drag && propsRef.current.placement && ctx.ghostMesh) {
        const g = groundPoint(event);
        if (g) {
          placeGhost(propsRef.current.placement.orientation, snapGround(g, event.shiftKey), GHOST_DEFAULT_LENGTH);
        }
        return;
      }
      if (!drag) return;
      if (drag.kind === 'place') {
        // 拖拽定长：轴投影增量 + 步进吸附（Shift = 1mm 丝滑）
        const t = axisProjection(event, drag.anchor, drag.axis);
        if (t === null) return;
        const step = event.shiftKey ? 1 : SNAP_MM;
        let len = drag.origLength + (t - drag.t0);
        len = Math.max(drag.minCut, Math.min(drag.maxCut, Math.round(len / step) * step));
        placeGhost(propsRef.current.placement?.orientation ?? 'y', drag.anchor, len);
        return;
      }
      if (drag.kind === 'move') {
        const grabbed = drag.originals.get(drag.id);
        if (!grabbed) return;
        let dx = 0;
        let dz = 0;
        let dy = 0;
        if (event.shiftKey) {
          // Shift+拖动：在过被抓取部件、面向相机的竖直平面上求交，只改高度（带部件 Y 吸附）
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          camDir.y = 0;
          if (camDir.lengthSq() < 1e-6) return;
          camDir.normalize();
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            camDir.negate(),
            new THREE.Vector3(grabbed.x, grabbed.y, grabbed.z),
          );
          raycaster.setFromCamera(ndc(event), camera);
          const p = new THREE.Vector3();
          if (!raycaster.ray.intersectPlane(plane, p)) return;
          let ny = Math.round(p.y / SNAP_MM) * SNAP_MM;
          const h = drag.grabbedBox.max.y - drag.grabbedBox.min.y;
          const snappedY = snapOrigin(ny, [ny, ny + h, ny + h / 2], drag.others.flatMap((o) => edgeTargets(o, 'y')));
          if (snappedY !== null) {
            ny = snappedY;
            showGuide(
              guideY,
              new THREE.Vector3(drag.grabbedBox.min.x - 20, ny, drag.grabbedBox.min.z - 20),
              new THREE.Vector3(drag.grabbedBox.max.x + 20, ny, drag.grabbedBox.max.z + 20),
            );
          } else {
            guideY.visible = false;
          }
          dy = ny - grabbed.y;
        } else {
          // 地面移动：10mm 栅格吸附 + 其他部件边/中心吸附（8mm 容差）
          const g = groundPoint(event);
          if (!g) return;
          let nx = Math.round((g.x - drag.grabDX) / SNAP_MM) * SNAP_MM;
          let nz = Math.round((g.z - drag.grabDZ) / SNAP_MM) * SNAP_MM;
          const w = drag.grabbedBox.max.x - drag.grabbedBox.min.x;
          const d = drag.grabbedBox.max.z - drag.grabbedBox.min.z;
          const snappedX = snapOrigin(nx, [nx, nx + w, nx + w / 2], drag.others.flatMap((o) => edgeTargets(o, 'x')));
          if (snappedX !== null) {
            nx = snappedX;
            showGuide(guideX, new THREE.Vector3(nx, 1, -2000), new THREE.Vector3(nx, 1, 2000));
          } else {
            guideX.visible = false;
          }
          const snappedZ = snapOrigin(nz, [nz, nz + d, nz + d / 2], drag.others.flatMap((o) => edgeTargets(o, 'z')));
          if (snappedZ !== null) {
            nz = snappedZ;
            showGuide(guideZ, new THREE.Vector3(-2000, 1, nz), new THREE.Vector3(2000, 1, nz));
          } else {
            guideZ.visible = false;
          }
          dx = nx - grabbed.x;
          dz = nz - grabbed.z;
        }
        const updates = [...drag.originals.entries()].map(([pid, pos]) => ({
          id: pid,
          position: { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz },
        }));
        propsRef.current.onMoveMany(updates);
        return;
      }
      // resize：把指针射线投影到挤出轴（相对抓取点计算增量）
      const { axis, lineOrigin, origLength, which, origPosition, origAxisPos, minCut, maxCut, t0 } = drag;
      const t = axisProjection(event, lineOrigin, axis);
      if (t === null) return;
      const dt = t - t0;
      let newLen: number;
      if (which === 'max') {
        // 拖最大端：向上(t 增大)伸长
        newLen = origLength + dt;
      } else {
        // 拖最小端：向下(t 减小)伸长
        newLen = origLength - dt;
      }
      newLen = Math.round(newLen / SNAP_MM) * SNAP_MM;
      newLen = Math.max(minCut, Math.min(maxCut, newLen));
      const axisIdx = (axis.x !== 0 ? 'x' : axis.y !== 0 ? 'y' : 'z') as 'x' | 'y' | 'z';
      const nextPosition = { ...origPosition };
      if (which === 'max') {
        // 最小端不动
      } else {
        // 最大端锚定：min-corner 沿轴平移 (newLen - origLength)·(−1)
        nextPosition[axisIdx] = origAxisPos + (origLength - newLen);
      }
      propsRef.current.onResize(drag.id, newLen, nextPosition);
    };

    const onPointerUp = () => {
      rightDown = null;
      hideGuides();
      // 放置完成：以 ghost 当前长度/位置创建部件（保持放置模式可连续放置）
      if (drag?.kind === 'place') {
        const ctx = sceneRef.current;
        const mesh = ctx?.ghostMesh;
        const placementNow = propsRef.current.placement;
        if (mesh && placementNow) {
          const cutLength = mesh.scale.z;
          const spec = findSpec(propsRef.current.catalog, placementNow.specCode);
          const dims = profileWorldDims(spec, cutLength, placementNow.orientation);
          propsRef.current.onPlaceProfile?.({
            specCode: placementNow.specCode,
            orientation: placementNow.orientation,
            cutLength,
            position: {
              x: mesh.position.x - dims[0] / 2,
              y: mesh.position.y - dims[1] / 2,
              z: mesh.position.z - dims[2] / 2,
            },
          });
        }
      }
      drag = null;
      if (sceneRef.current) sceneRef.current.controls.enabled = true;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // 右键 context 菜单：多选 ≥2 且非拖拽时触发（拖拽留给 OrbitControls 平移）
    const onContextMenuOpen = (e: MouseEvent) => {
      e.preventDefault();
      if (propsRef.current.placement) return;
      const moved = rightDown !== null && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) > 6;
      rightDown = null;
      if (moved) return;
      if (propsRef.current.selectedIds.length < 2) return;
      propsRef.current.onContextMenu?.({ x: e.clientX, y: e.clientY });
    };
    renderer.domElement.addEventListener('contextmenu', onContextMenuOpen);

    /* ------------------------------- 快捷键 ------------------------------- */
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      // Esc 退出放置模式（无需选中部件）
      if (event.key === 'Escape' && propsRef.current.placement) {
        event.preventDefault();
        propsRef.current.onCancelPlacement?.();
        return;
      }
      const { model: m, selectedIds: sels, onResize: doResize, onMove: doMove } = propsRef.current;
      const sel = sels[sels.length - 1] ?? null; // 键盘操作作用于最后点击的部件
      if (!sel) return;
      const profile = m.profiles.find((p) => p.id === sel);
      const panel = m.panels.find((p) => p.id === sel);
      const spec = profile ? findSpec(propsRef.current.catalog, profile.specCode) : undefined;
      const step = SNAP_MM;
      if (profile && spec && (event.key === '[' || event.key === ']')) {
        const delta = event.key === '[' ? -step : step;
        const nextLen = Math.max(spec.minCutLength, Math.min(spec.maxCutLength, profile.cutLength + delta));
        event.preventDefault();
        doResize(sel, nextLen, { ...profile.position });
        return;
      }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        const base = profile ? profile.position : panel?.position;
        if (!base) return;
        event.preventDefault();
        doMove(sel, { x: base.x, y: base.y + (event.key === 'PageUp' ? step : -step), z: base.z });
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const base = profile ? profile.position : panel?.position;
        if (!base) return;
        event.preventDefault();
        const next = { ...base };
        if (event.key === 'ArrowLeft') next.x -= step;
        else if (event.key === 'ArrowRight') next.x += step;
        else if (event.key === 'ArrowUp') next.z -= step;
        else if (event.key === 'ArrowDown') next.z += step;
        doMove(sel, next);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenuOpen);
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  /* ---------------- ghost 放置网格（随 placement 规格重建） ---------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { ghostGroup, invalidate } = ctx;
    if (ctx.ghostMesh) {
      ghostGroup.remove(ctx.ghostMesh);
      ctx.ghostMesh = null;
    }
    if (!placement) {
      invalidate(); // 移除了可见的 ghost → 需要重绘
      return;
    }
    const spec = findSpec(catalog, placement.specCode);
    if (!spec) return;
    const entry = getProfileGeometry(spec);
    const mesh = new THREE.Mesh(entry.geometry, ghostMaterial);
    mesh.scale.z = GHOST_DEFAULT_LENGTH;
    mesh.visible = false; // 首次 pointermove 前不显示
    ctx.ghostMesh = mesh;
    ghostGroup.add(mesh);
    invalidate();
    return () => {
      if (ctx.ghostMesh) {
        ghostGroup.remove(ctx.ghostMesh);
        ctx.ghostMesh = null;
        invalidate();
      }
    };
  }, [placement, catalog]);

  /* ---------------------- 模型变化 → 重建部件网格 ---------------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { partGroup, invalidate } = ctx;
    const selSet = new Set(selectedIds);
    partGroup.clear();
    const disposables: Array<THREE.BufferGeometry> = [];

    for (const p of model.profiles) {
      const spec = findSpec(catalog, p.specCode);
      const entry = getProfileGeometry(spec ?? ({ width: 30, height: 30, slotWidth: 8 } as ProfileSpec));
      const selected = selSet.has(p.id);
      const finishColor = p.finishId ? findFinish(catalog, p.finishId)?.colorHex : undefined;
      const mesh = new THREE.Mesh(
        entry.geometry,
        finishColor
          ? getFinishMaterial(finishColor, selected)
          : selected
            ? aluminumSelectedMaterial
            : aluminumMaterial,
      );
      const dims = profileWorldDims(spec, p.cutLength, p.orientation);
      mesh.scale.z = p.cutLength; // 挤出深度 1 → 切割长度
      mesh.quaternion.copy(orientationQuaternion(p.orientation));
      mesh.position.set(
        p.position.x + dims[0] / 2,
        p.position.y + dims[1] / 2,
        p.position.z + dims[2] / 2,
      );
      mesh.userData['partId'] = p.id;
      mesh.userData['minCorner'] = { ...p.position };
      const record: PartRecord = {
        mesh,
        kind: 'profile',
        spec,
        orientation: p.orientation,
        cutLength: p.cutLength,
        dims,
        quaternion: mesh.quaternion.clone(),
      };
      mesh.userData['record'] = record;
      if (selected) {
        const edges = new THREE.LineSegments(entry.edges, edgeMaterial);
        mesh.add(edges);
      }
      partGroup.add(mesh);
    }

    for (const p of model.panels) {
      const dims =
        p.plane === 'xy'
          ? ([p.width, p.height, p.thickness] as [number, number, number])
          : p.plane === 'xz'
            ? ([p.width, p.thickness, p.height] as [number, number, number])
            : ([p.thickness, p.width, p.height] as [number, number, number]);
      const geometry = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
      disposables.push(geometry);
      const selected = selSet.has(p.id);
      const mesh = new THREE.Mesh(geometry, selected ? panelSelectedMaterial : panelMaterial);
      mesh.position.set(
        p.position.x + dims[0] / 2,
        p.position.y + dims[1] / 2,
        p.position.z + dims[2] / 2,
      );
      mesh.userData['partId'] = p.id;
      mesh.userData['minCorner'] = { ...p.position };
      const record: PartRecord = {
        mesh,
        kind: 'panel',
        orientation: 'z',
        cutLength: dims[2],
        dims,
        quaternion: new THREE.Quaternion(),
      };
      mesh.userData['record'] = record;
      if (selected) {
        const edges = new THREE.EdgesGeometry(geometry, 24);
        disposables.push(edges);
        mesh.add(new THREE.LineSegments(edges, edgeMaterial));
      }
      partGroup.add(mesh);
    }

    invalidate();
    return () => {
      for (const g of disposables) g.dispose();
    };
  }, [model, catalog, selectedIds]);

  useImperativeHandle(ref, () => ({ resetView: () => resetViewRef.current() }), []);

  /* ---------------- 选中型材 → 两端调长手柄（箭头） ---------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { handleGroup, invalidate } = ctx;
    handleGroup.clear();
    invalidate(); // 手柄出现/消失都改变画面
    if (selectedIds.length !== 1) return; // 仅单选显示调长手柄
    const profile = model.profiles.find((p) => p.id === selectedIds[0]);
    if (!profile) return; // 面板不做 3D 调长
    const spec = findSpec(catalog, profile.specCode);
    const dims = profileWorldDims(spec, profile.cutLength, profile.orientation);
    const { axis } = orientationAxis(profile.orientation);
    const center = new THREE.Vector3(
      profile.position.x + dims[0] / 2,
      profile.position.y + dims[1] / 2,
      profile.position.z + dims[2] / 2,
    );
    const half = axis.clone().multiplyScalar(profile.cutLength / 2);
    const minEnd = center.clone().sub(half);
    const maxEnd = center.clone().add(half);

    const makeHandle = (which: 'min' | 'max') => {
      const mesh = new THREE.Mesh(handleGeometry, handleMaterial);
      const dir = which === 'max' ? axis.clone() : axis.clone().negate();
      mesh.position.copy((which === 'max' ? maxEnd : minEnd).clone().add(dir.clone().multiplyScalar(22)));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.userData['partId'] = profile.id;
      mesh.userData['which'] = which;
      handleGroup.add(mesh);
    };
    makeHandle('min');
    makeHandle('max');
  }, [model, catalog, selectedIds]);

  return <div ref={containerRef} className="viewer3d" data-testid="viewer3d" />;
});
