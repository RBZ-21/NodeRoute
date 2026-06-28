import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

export type ProductMedia = {
  id: string;
  product_id: string;
  media_type: 'image' | 'library' | 'url';
  url: string;
  label?: string | null;
  sort_order: number;
  created_at?: string;
};

export type ProductMediaCreateInput = {
  product_id: string;
  media_type?: ProductMedia['media_type'];
  url: string;
  label?: string;
  sort_order?: number;
};

export type ProductMediaPatchInput = {
  id: string;
  label?: string;
  sort_order?: number;
};

const key = (productId: string) => ['product-media', productId] as const;

export function useProductMedia(productId: string | null | undefined) {
  return useQuery({
    queryKey: key(productId || ''),
    enabled: !!productId,
    queryFn: () =>
      fetchWithAuth<{ media: ProductMedia[] }>(`/api/product-media?productId=${encodeURIComponent(productId || '')}`)
        .then((data) => data.media || []),
    staleTime: 30_000,
  });
}

export function useCreateProductMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductMediaCreateInput) =>
      sendWithAuth<{ media: ProductMedia }>('/api/product-media', 'POST', input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: key(variables.product_id) });
    },
  });
}

export function useUpdateProductMedia(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: ProductMediaPatchInput) =>
      sendWithAuth<{ media: ProductMedia }>(`/api/product-media/${encodeURIComponent(id)}`, 'PATCH', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(productId) });
    },
  });
}

export function useDeleteProductMedia(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      sendWithAuth<{ ok: true }>(`/api/product-media/${encodeURIComponent(id)}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(productId) });
    },
  });
}
