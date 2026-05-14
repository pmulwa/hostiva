import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CountryPicker } from '@/components/admin/CountryPicker';

/** Open the picker and return its dropdown root. */
const openPicker = () => {
  const trigger = screen.getByRole('combobox');
  fireEvent.click(trigger);
  // Search input gets autoFocus → its parent popover content is now mounted.
  return screen.getByLabelText('Search countries');
};

describe('<CountryPicker />', () => {
  it('preselects India when value="IN" and shows the +91 dial code', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('India');
    expect(trigger).toHaveTextContent('+91');
  });

  it('opens the dropdown with a search input visible above the list', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    const search = openPicker();
    expect(search).toBeInTheDocument();
    expect(search).toHaveAttribute('placeholder', expect.stringMatching(/search countries/i));
    // India option is rendered in the visible list
    expect(screen.getByTestId('country-option-IN')).toBeInTheDocument();
  });

  it('positions the dropdown content with a high z-index so it stays in front of dialogs', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    openPicker();
    const india = screen.getByTestId('country-option-IN');
    // Walk up until we find the popover content wrapper (carries our z-[60] class).
    let node: HTMLElement | null = india;
    let found = false;
    while (node) {
      if (node.className && /z-\[200\]/.test(node.className)) {
        found = true;
        break;
      }
      node = node.parentElement;
    }
    expect(found).toBe(true);
  });

  it('filters as the user types and highlights the match', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    const search = openPicker();

    fireEvent.change(search, { target: { value: 'keny' } });

    // Kenya is in the filtered list, India is not.
    const kenya = screen.getByTestId('country-option-KE');
    expect(kenya).toBeInTheDocument();
    expect(screen.queryByTestId('country-option-IN')).not.toBeInTheDocument();

    // The matched substring is wrapped in <mark> for visual highlighting.
    const mark = within(kenya).getByText('Keny');
    expect(mark.tagName).toBe('MARK');
  });

  it('searches by dial code (e.g. "254" finds Kenya)', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    const search = openPicker();

    fireEvent.change(search, { target: { value: '254' } });
    expect(screen.getByTestId('country-option-KE')).toBeInTheDocument();
  });

  it('renders a friendly empty state when nothing matches', () => {
    render(<CountryPicker value="IN" onChange={() => {}} />);
    const search = openPicker();
    fireEvent.change(search, { target: { value: 'zzzzzzz' } });
    expect(screen.getByText(/no country matches/i)).toBeInTheDocument();
  });

  it('invokes onChange with the selected country (Kenya → +254)', () => {
    const onChange = vi.fn();
    render(<CountryPicker value="IN" onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByTestId('country-option-KE'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ code: 'KE', dial: '254', name: 'Kenya' });
  });
});