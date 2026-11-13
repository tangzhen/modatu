import { create } from 'zustand';
import { api, type PublicUser, type PublicConfig } from '../api';

interface AuthState {
  user: PublicUser | null;
  config: PublicConfig | null;
  /** 启动时拉取会话与公开配置 */
  init: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  config: null,
  init: async () => {
    const config = await api<PublicConfig>('/config').catch(() => null);
    set({ config });
    const user = await api<PublicUser>('/auth/me').catch(() => null);
    set({ user });
  },
  refreshUser: async () => {
    const user = await api<PublicUser>('/auth/me').catch(() => null);
    set({ user });
  },
  setUser: (user) => set({ user }),
  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    set({ user: null });
  },
}));
