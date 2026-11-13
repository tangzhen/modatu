import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DesignModel } from '@modatu/design-model';
import type { CatalogSnapshot } from '@modatu/catalog';

/**
 * 渲染层（spec-04 架构决策）：只消费模型状态绘制场景 + 把拾取事件转回部件 id。
 * 不包含任何编辑逻辑；与模型/状态层严格解耦（手机端可替换此层）。
 * mm → 场景单位 1:1（相机距离补偿）；型材按真实截面，板材按真实厚度。
 */

export interface Viewer3DProps {
  model: DesignModel;
  catalog: CatalogSnapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 受约束拖拽：沿地面 XZ 平面移动并吸附 10mm 栅格 */
  onDrag: (id: string, x: number, z: number) => void;
}

const PROFILE_COLOR = 0x9aa5b1;
const PANEL_COLOR = 0xc98d5a;
const SELECTED_COLOR = 0xffd54f;
const SNAP_MM = 10;

export function Viewer3D({ model, catalog, selectedId, onSelect, onDrag }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    group: THREE.Group;
  } | null>(null);
  const propsRef = useRef({ model, catalog, selectedId, onSelect, onDrag });
  propsRef.current = { model, catalog, selectedId, onSelect, onDrag };

  // 初始化场景（一次性）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f8);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
    camera.position.set(2500, 2000, 2500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const raycaster = new THREE.Raycaster();
    const group = new THREE.Group();
    scene.add(group);

    // 地面栅格 + 光源
    const grid = new THREE.GridHelper(4000, 40, 0xb0b8c0, 0xd8dee4);
    scene.add(grid);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(2000, 3000, 1500);
    scene.add(dir);

    sceneRef.current = { scene, camera, renderer, controls, raycaster, group };

    const resize = () => {
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(window.devicePixelRatio);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    /* ------------------------- 拾取与受约束拖拽 ------------------------- */
    let dragging: { id: string } | null = null;
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const partIdFromEvent = (event: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(group.children, false);
      const hit = hits[0];
      return hit ? ((hit.object.userData['partId'] as string) ?? null) : null;
    };

    const pointerToGround = (event: PointerEvent): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const point = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, point) ? point : null;
    };

    const onPointerDown = (event: PointerEvent) => {
      const id = partIdFromEvent(event);
      propsRef.current.onSelect(id);
      if (id) dragging = { id };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const point = pointerToGround(event);
      if (!point) return;
      const x = Math.round(point.x / SNAP_MM) * SNAP_MM;
      const z = Math.round(point.z / SNAP_MM) * SNAP_MM;
      propsRef.current.onDrag(dragging.id, x, z);
    };
    const onPointerUp = () => {
      dragging = null;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // 模型变化 → 重建部件网格（一期数据量小，直接重建；实例化渲染为储备优化）
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { group } = ctx;
    group.clear();

    for (const p of model.profiles) {
      const spec = catalog.profiles.find((s) => s.code === p.specCode);
      const w = spec?.width ?? 30;
      const h = spec?.height ?? 30;
      const dims =
        p.orientation === 'x'
          ? [p.cutLength, h, w]
          : p.orientation === 'y'
            ? [w, p.cutLength, h]
            : [w, h, p.cutLength];
      const geometry = new THREE.BoxGeometry(dims[0]!, dims[1]!, dims[2]!);
      const material = new THREE.MeshLambertMaterial({
        color: p.id === selectedId ? SELECTED_COLOR : PROFILE_COLOR,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        p.position.x + dims[0]! / 2,
        p.position.y + dims[1]! / 2,
        p.position.z + dims[2]! / 2,
      );
      mesh.userData['partId'] = p.id;
      group.add(mesh);
    }

    for (const p of model.panels) {
      const dims =
        p.plane === 'xy'
          ? [p.width, p.height, p.thickness]
          : p.plane === 'xz'
            ? [p.width, p.thickness, p.height]
            : [p.thickness, p.width, p.height];
      const geometry = new THREE.BoxGeometry(dims[0]!, dims[1]!, dims[2]!);
      const material = new THREE.MeshLambertMaterial({
        color: p.id === selectedId ? SELECTED_COLOR : PANEL_COLOR,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        p.position.x + dims[0]! / 2,
        p.position.y + dims[1]! / 2,
        p.position.z + dims[2]! / 2,
      );
      mesh.userData['partId'] = p.id;
      group.add(mesh);
    }
  }, [model, catalog, selectedId]);

  return <div ref={containerRef} className="viewer3d" data-testid="viewer3d" />;
}
