export type UserRole = 'driver' | 'manager' | 'admin' | 'superadmin' | string;

export type DriverUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type DriverStop = {
  id: string;
  route_id?: string | null;
  name?: string | null;
  address?: string | null;
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  notes?: string | null;
  driver_notes?: string | null;
  door_code?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_has_signature?: boolean;
  invoice_has_proof_of_delivery?: boolean;
  invoice_proof_of_delivery_uploaded_at?: string | null;
  arrived_at?: string | null;
  position?: number;
};

export type DriverRoute = {
  id: string;
  name?: string | null;
  driver?: string | null;
  driver_email?: string | null;
  notes?: string | null;
  created_at?: string | null;
  stops: DriverStop[];
};

export type DriverInvoice = {
  id: string;
  invoice_number?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  status?: string | null;
  signed_at?: string | null;
  sent_at?: string | null;
  items?: Array<Record<string, unknown>>;
  proof_of_delivery_uploaded_at?: string | null;
  proof_of_delivery_image_data?: string | null;
  signature_data?: string | null;
};

export type DeliveryRecord = {
  orderDbId: string;
  orderId?: string | null;
  restaurantName?: string | null;
  address?: string | null;
  routeId?: string | null;
  status?: string | null;
  items?: string[];
};

export type DriverSummary = {
  onTimeRate?: number;
  totalStopsToday?: number;
  milesToday?: number;
  avgStopMinutes?: number;
  avgSpeedMph?: number;
  status?: string;
  vehicleId?: string | null;
};

export type BootstrapPayload = {
  routes: DriverRoute[];
  invoices: DriverInvoice[];
  deliveries: DeliveryRecord[];
  summary: DriverSummary | null;
  cachedAt: string;
};

export type ToastTone = 'success' | 'error' | 'info';

export type ToastMessage = {
  id: number;
  title: string;
  tone: ToastTone;
};
