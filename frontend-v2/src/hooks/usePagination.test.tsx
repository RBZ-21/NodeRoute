import { fireEvent, render, screen } from '@testing-library/react';
import { usePagination } from './usePagination';

function PaginationProbe({ items, pageSize }: { items: number[]; pageSize: number }) {
  const pagination = usePagination(items, pageSize);
  return (
    <div>
      <div data-testid="page">{pagination.page}</div>
      <div data-testid="page-count">{pagination.pageCount}</div>
      <div data-testid="items">{pagination.pageItems.join(',')}</div>
      <button type="button" onClick={() => pagination.setPage(pagination.page + 1)}>Next</button>
    </div>
  );
}

describe('usePagination', () => {
  it('slices items and resets to page 1 when the filtered item set changes', () => {
    const { rerender } = render(<PaginationProbe items={[1, 2, 3, 4, 5, 6]} pageSize={2} />);

    expect(screen.getByTestId('page').textContent).toBe('1');
    expect(screen.getByTestId('page-count').textContent).toBe('3');
    expect(screen.getByTestId('items').textContent).toBe('1,2');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('page').textContent).toBe('2');
    expect(screen.getByTestId('items').textContent).toBe('3,4');

    rerender(<PaginationProbe items={[4, 5]} pageSize={2} />);
    expect(screen.getByTestId('page').textContent).toBe('1');
    expect(screen.getByTestId('page-count').textContent).toBe('1');
    expect(screen.getByTestId('items').textContent).toBe('4,5');
  });
});
