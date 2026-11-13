import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './stores/auth';
import { LoginPage, HiddenLoginPage } from './pages/LoginPage';
import { DesignsPage } from './pages/DesignsPage';
import { EditorPage } from './pages/EditorPage';
import { AdminCatalogPage } from './pages/AdminCatalogPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const init = useAuth((s) => s.init);
  const user = useAuth((s) => s.user);
  const config = useAuth((s) => s.config);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <Routes>
      {/* dev 账密登录页：flag 关闭时仍可渲染但提交被拒（服务端 404 兜底） */}
      <Route
        path="/login"
        element={
          config && !config.devPasswordLogin ? (
            <LoginPageHiddenRedirect />
          ) : (
            <LoginPage />
          )
        }
      />
      {/* 隐藏登录页：固定路由，不在任何导航/站点地图中暴露（spec-03 决策 7） */}
      <Route path="/login/hidden" element={<HiddenLoginPage />} />
      <Route path="/designs" element={<DesignsPage />} />
      <Route path="/editor" element={<EditorPage />} />
      <Route path="/editor/:id" element={<EditorPage />} />
      <Route
        path="/admin/catalog"
        element={user?.role === 'admin' ? <AdminCatalogPage /> : <Navigate to="/login?next=/admin/catalog" />}
      />
      <Route
        path="/admin/users"
        element={user?.role === 'admin' ? <AdminUsersPage /> : <Navigate to="/login?next=/admin/users" />}
      />
      <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login?next=/settings" />} />
      <Route path="*" element={<Navigate to={user ? '/designs' : '/editor'} />} />
    </Routes>
  );
}

function LoginPageHiddenRedirect() {
  return <Navigate to="/login/hidden" />;
}
