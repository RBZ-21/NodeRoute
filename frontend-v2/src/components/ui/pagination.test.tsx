import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaginationControls } from './pagination';

describe('PaginationControls', () => {
  it('navigates pages and changes page size', () => {
    const setPage = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <PaginationControls
        page={2}
        pageCount={4}
        itemCount={78}
        pageSize={25}
        setPage={setPage}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('Showing 26-50 of 78')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(setPage).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(setPage).toHaveBeenCalledWith(3);

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
