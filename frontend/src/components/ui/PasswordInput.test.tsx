import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { useRef } from 'react';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('defaults to a hidden password field', () => {
    render(<PasswordInput placeholder="Secret" />);
    expect(screen.getByPlaceholderText('Secret')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('toggles visibility via the eye button', () => {
    render(<PasswordInput placeholder="Secret" />);
    const field = screen.getByPlaceholderText('Secret');

    fireEvent.click(screen.getByRole('button', { name: 'Show input' }));
    expect(field).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide input' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('forwards value/onChange and the ref', () => {
    const onChange = vi.fn();
    function Harness() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <PasswordInput
          ref={ref}
          placeholder="Secret"
          value="abc"
          onChange={onChange}
          data-ref-check
        />
      );
    }
    render(<Harness />);
    const field = screen.getByPlaceholderText('Secret');
    expect(field).toHaveValue('abc');
    expect(field).toHaveAttribute('data-ref-check');
    fireEvent.change(field, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalled();
  });
});
