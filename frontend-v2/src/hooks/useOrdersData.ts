import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchWithAuth } from '../lib/api';
import type { Customer, InventoryProduct, LotCode, Order } from '../pages/orders.types';

export function useOrdersData() {
  const [searchParams] = useSearchParams();
  const customerIdParam = String(searchParams.get('customerId') || '').trim();

  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [lotsCache, setLotsCache] = useState<Record<string, LotCode[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = customerIdParam ? `?customerId=${encodeURIComponent(customerIdParam)}` : '';
      const data = await fetchWithAuth<Order[]>(`/api/orders${query}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load orders'));
    } finally {
      setLoading(false);
    }
  }, [customerIdParam]);

  const loadProducts = useCallback(async () => {
    try {
      const data = await fetchWithAuth<InventoryProduct[]>('/api/inventory');
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      // non-fatal — FTL dropdown just won't show items
    }
  }, []);

  const loadLotsForProduct = useCallback(async (itemNumber: string) => {
    if (!itemNumber || lotsCache[itemNumber]) return;
    try {
      const data = await fetchWithAuth<LotCode[]>(`/api/lots?product_id=${encodeURIComponent(itemNumber)}&active_only=true`);
      setLotsCache((prev) => ({ ...prev, [itemNumber]: Array.isArray(data) ? data : [] }));
    } catch {
      setLotsCache((prev) => ({ ...prev, [itemNumber]: [] }));
    }
  }, [lotsCache]);

  useEffect(() => {
    void load();
    void loadProducts();
    fetchWithAuth<Customer[]>('/api/customers')
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [customerIdParam]);

  return {
    orders,
    setOrders,
    customers,
    products,
    lotsCache,
    loading,
    error,
    setError,
    load,
    loadLotsForProduct,
    customerIdParam,
  };
}
