import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StopDetailPage } from '@/pages/StopDetailPage';

const pushToastMock = vi.fn();
const sendLocationMock = vi.fn();
const captureSignatureMock = vi.fn();
const deferStopToEndMock = vi.fn();
const markArrivedMock = vi.fn();
const markDeliveredMock = vi.fn();
const markFailedMock = vi.fn();
const refreshOfflineDraftsMock = vi.fn();
const saveStopNotesMock = vi.fn();
const stopItemsMock = vi.fn(() => ['Salmon x2']);

const baseStop = {
  id: 'stop-1',
  name: 'Blue Fin',
  address: '1 Dock Street',
  status: 'pending',
  invoice_id: 'inv-1',
  invoice_number: 'INV-1001',
  invoice_has_signature: false,
  invoice_has_proof_of_delivery: true,
  driver_notes: '',
};

type DriverAppMock = {
  captureSignature: typeof captureSignatureMock;
  companySettings: {
    forceDriverSignature: boolean;
    forceDriverProofOfDelivery: boolean;
    businessName: string;
  };
  deferStopToEnd: typeof deferStopToEndMock;
  getStopStatusConflict: ReturnType<typeof vi.fn>;
  isOnline: boolean;
  markArrived: typeof markArrivedMock;
  markDelivered: typeof markDeliveredMock;
  markFailed: typeof markFailedMock;
  refreshOfflineDrafts: typeof refreshOfflineDraftsMock;
  resolveStatusConflict: ReturnType<typeof vi.fn>;
  saveStopNotes: typeof saveStopNotesMock;
  stopById: ReturnType<typeof vi.fn>;
  stopItems: typeof stopItemsMock;
};

let driverAppValue: DriverAppMock;

function createDriverAppValue(overrides: Partial<DriverAppMock> = {}): DriverAppMock {
  return {
    captureSignature: captureSignatureMock,
    companySettings: {
      forceDriverSignature: false,
      forceDriverProofOfDelivery: false,
      businessName: 'NodeRoute',
    },
    deferStopToEnd: deferStopToEndMock,
    getStopStatusConflict: vi.fn(() => null),
    isOnline: true,
    markArrived: markArrivedMock,
    markDelivered: markDeliveredMock,
    markFailed: markFailedMock,
    refreshOfflineDrafts: refreshOfflineDraftsMock,
    resolveStatusConflict: vi.fn(),
    saveStopNotes: saveStopNotesMock,
    stopById: vi.fn(() => baseStop),
    stopItems: stopItemsMock,
    ...overrides,
  };
}

vi.mock('@/hooks/useDriverApp', () => ({
  useDriverApp: () => driverAppValue,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    pushToast: pushToastMock,
  }),
}));

vi.mock('@/hooks/useLocationUpdater', () => ({
  useLocationUpdater: () => ({
    sendLocation: sendLocationMock,
  }),
}));

vi.mock('@/lib/storage', () => ({
  clearStopDraft: vi.fn(),
  loadStopDraft: vi.fn(() => null),
  saveStopDraft: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stops/stop-1']}>
      <Routes>
        <Route path="/stops/:stopId" element={<StopDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('StopDetailPage', () => {
  beforeEach(() => {
    pushToastMock.mockReset();
    sendLocationMock.mockReset();
    captureSignatureMock.mockReset();
    deferStopToEndMock.mockReset();
    markArrivedMock.mockReset();
    markDeliveredMock.mockReset();
    markFailedMock.mockReset();
    refreshOfflineDraftsMock.mockReset();
    saveStopNotesMock.mockReset();
    stopItemsMock.mockClear();
    driverAppValue = createDriverAppValue();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      lineWidth: 0,
      lineCap: 'round',
      lineJoin: 'round',
      strokeStyle: '#0f172a',
      fillStyle: '#ffffff',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,signature');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures a signature before auto-delivering when company policy requires it', async () => {
    driverAppValue = createDriverAppValue({
      companySettings: {
        forceDriverSignature: true,
        forceDriverProofOfDelivery: false,
        businessName: 'NodeRoute',
      },
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Capture Signature + Deliver' }));

    expect(await screen.findByText('Customer signature')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Alex Receiver' } });

    const canvas = document.querySelector('canvas');
    expect(canvas).not.toBeNull();
    fireEvent.mouseDown(canvas!, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas!, { clientX: 40, clientY: 20 });
    fireEvent.mouseUp(canvas!);
    fireEvent.click(screen.getByRole('button', { name: 'Save Signature' }));

    await waitFor(() => {
      expect(captureSignatureMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stop-1' }),
        'data:image/png;base64,signature',
        'Alex Receiver',
      );
    });

    await waitFor(() => {
      expect(markDeliveredMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stop-1', invoice_has_signature: true }),
        null,
        '',
      );
    });

    expect(sendLocationMock).toHaveBeenCalled();
  });

  it('blocks failed-stop submission until an exception reason is chosen', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Mark Failed' }));

    expect(pushToastMock).toHaveBeenCalledWith(
      'Choose an exception reason before marking this stop failed.',
      'error',
    );
    expect(markFailedMock).not.toHaveBeenCalled();
  });

  it('submits the selected exception reason with failed-stop notes', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Exception reason'), {
      target: { value: 'Access issue' },
    });
    fireEvent.change(screen.getByPlaceholderText('Gate instructions, failed-delivery reason, or delivery notes'), {
      target: { value: 'Gate locked and no one answered the call box.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Failed' }));

    await waitFor(() => {
      expect(markFailedMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stop-1' }),
        'Access issue',
        'Gate locked and no one answered the call box.',
      );
    });
    expect(sendLocationMock).toHaveBeenCalled();
  });

  it('records a drop-off delivery without requiring a signature', async () => {
    driverAppValue = createDriverAppValue({
      companySettings: {
        forceDriverSignature: true,
        forceDriverProofOfDelivery: false,
        businessName: 'NodeRoute',
      },
    });

    renderPage();

    fireEvent.change(screen.getByPlaceholderText('Gate instructions, failed-delivery reason, or delivery notes'), {
      target: { value: 'Left in the lobby cooler.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Drop Off (No Signature)' }));

    await waitFor(() => {
      expect(markDeliveredMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stop-1' }),
        null,
        'Left in the lobby cooler.',
        { deliveryMode: 'drop_off' },
      );
    });
  });
});
