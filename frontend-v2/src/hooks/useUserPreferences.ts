import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type NavigationPreference = {
  nav_item_ids: string[];
  updated_at?: string | null;
};

export type DashboardLayoutPreference = {
  view_type: string;
  layout: {
    widgets?: Record<string, boolean>;
    [key: string]: unknown;
  };
  updated_at?: string | null;
};

export const userPreferenceKeys = {
  navigation: ['user-preferences', 'navigation'] as const,
  dashboardLayout: (viewType: string) => ['dashboard-layouts', viewType] as const,
};

export function useNavigationPreference() {
  return useQuery({
    queryKey: userPreferenceKeys.navigation,
    queryFn: () => fetchWithAuth<NavigationPreference>('/api/user-preferences/navigation'),
    staleTime: 60_000,
  });
}

export function useSaveNavigationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (navItemIds: string[]) =>
      sendWithAuth<NavigationPreference>('/api/user-preferences/navigation', 'PUT', { nav_item_ids: navItemIds }),
    onSuccess: (data) => {
      queryClient.setQueryData(userPreferenceKeys.navigation, data);
    },
  });
}

export function useDashboardLayout(viewType: string) {
  return useQuery({
    queryKey: userPreferenceKeys.dashboardLayout(viewType),
    queryFn: () => fetchWithAuth<DashboardLayoutPreference>(`/api/dashboard-layouts?viewType=${encodeURIComponent(viewType)}`),
    staleTime: 30_000,
  });
}

export function useSaveDashboardLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ view_type, layout }: { view_type: string; layout: DashboardLayoutPreference['layout'] }) =>
      sendWithAuth<DashboardLayoutPreference>('/api/dashboard-layouts', 'PUT', { view_type, layout }),
    onSuccess: (data) => {
      queryClient.setQueryData(userPreferenceKeys.dashboardLayout(data.view_type), data);
    },
  });
}
