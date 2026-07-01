import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from '../components/ui/toast';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

export function renderWithQueryClient(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { wrapper?: ({ children }: { children: ReactNode }) => JSX.Element },
) {
  const queryClient = createTestQueryClient();
  const Wrapper = options?.wrapper
    ? options.wrapper
    : ({ children }: { children: ReactNode }) => <>{children}</>;
  const { wrapper: _wrapper, ...renderOptions } = options ?? {};

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Wrapper>{ui}</Wrapper>
      </ToastProvider>
    </QueryClientProvider>,
    renderOptions,
  );

  return {
    queryClient,
    ...renderResult,
    unmount: () => {
      renderResult.unmount();
      queryClient.clear();
    },
  };
}
