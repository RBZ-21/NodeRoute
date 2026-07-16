import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListWithAuth, sendWithAuth } from '../lib/api';

export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | 'warehouse';

export type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  createdAt?: string;
  companyName?: string;
  locationName?: string;
};

export type InviteResult = {
  message?: string;
  userId?: string;
  inviteUrl?: string;
  emailSent?: boolean;
  emailQueued?: boolean;
  emailError?: string | null;
  emailProvider?: string | null;
};

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => fetchListWithAuth<UserRecord>('/api/users'),
    staleTime: 30_000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; email: string; role: Role }) =>
      sendWithAuth<InviteResult>('/api/users/invite', 'POST', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useAddUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; email: string; password: string; role: Role }) =>
      sendWithAuth('/api/users', 'POST', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      sendWithAuth(`/api/users/${id}/role`, 'PATCH', { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendWithAuth(`/api/users/${id}`, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
