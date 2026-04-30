import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from './UsersPage';

const { fetchWithAuthMock, getUserRoleMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  getUserRoleMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  getUserRole: getUserRoleMock,
  sendWithAuth: sendWithAuthMock,
}));

const baseUsers = [
  {
    id: 'user-1',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
    createdAt: '2026-04-01T00:00:00Z',
    companyName: 'NodeRoute',
    locationName: 'HQ',
  },
  {
    id: 'user-2',
    name: 'Jamie Driver',
    email: 'jamie@example.com',
    role: 'driver',
    status: 'pending',
    createdAt: '2026-04-02T00:00:00Z',
  },
];

function mockUsersApi(users = baseUsers) {
  fetchWithAuthMock.mockImplementation(async (url: string) => {
    if (url === '/api/users') return users;
    return [];
  });
}

describe('UsersPage', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    getUserRoleMock.mockReset();
    sendWithAuthMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
    localStorage.clear();
    localStorage.setItem('nr_user', JSON.stringify({ id: 'user-1', email: 'admin@example.com' }));
    getUserRoleMock.mockReturnValue('admin');
    mockUsersApi();
  });

  it('creates an active user and sends an invite with manual link support', async () => {
    sendWithAuthMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ inviteUrl: 'https://invite.test/token', emailSent: false });

    render(<UsersPage />);

    expect(await screen.findByText('Jamie Driver')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    expect(await screen.findByText('Name, email, and password are all required.')).toBeInTheDocument();

    fireEvent.change(screen.getAllByPlaceholderText('Full name')[0], { target: { value: 'Taylor Ops' } });
    fireEvent.change(screen.getByPlaceholderText('email@company.com'), { target: { value: 'taylor@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 chars)'), { target: { value: 'strongpass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/users', 'POST', {
        name: 'Taylor Ops',
        email: 'taylor@example.com',
        password: 'strongpass',
        role: 'driver',
      });
    });
    expect(await screen.findByText('User taylor@example.com created and set to active.')).toBeInTheDocument();

    const fullNameInputs = screen.getAllByPlaceholderText('Full name');
    const inviteEmailInputs = screen.getAllByPlaceholderText(/email/i);
    fireEvent.change(fullNameInputs[1], { target: { value: 'Jordan Manager' } });
    fireEvent.change(inviteEmailInputs[1], { target: { value: 'jordan@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));

    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/users/invite', 'POST', {
        name: 'Jordan Manager',
        email: 'jordan@example.com',
        role: 'driver',
      });
    });
    expect(await screen.findByText(/Invite created\. No email provider configured/)).toBeInTheDocument();
    expect(screen.getByText('https://invite.test/token')).toBeInTheDocument();
  });

  it('filters the directory and supports role updates and removal', async () => {
    sendWithAuthMock.mockResolvedValue({});

    render(<UsersPage />);

    expect(await screen.findByText('Jamie Driver')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('All Roles'), { target: { value: 'driver' } });

    await waitFor(() => {
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.getByText('Jamie Driver')).toBeInTheDocument();
    });

    const jamieRow = screen.getByText('Jamie Driver').closest('tr') as HTMLElement | null;
    if (!jamieRow) throw new Error('Expected Jamie row');
    fireEvent.change(jamieRow.querySelector('select') as HTMLSelectElement, { target: { value: 'manager' } });
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/users/user-2/role', 'PATCH', { role: 'manager' });
    });

    fireEvent.click(within(jamieRow).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/users/user-2', 'DELETE');
    });
  });
});
