import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderTextWithMentions } from './renderMentions';
import { MentionRef } from '../api/issues';

afterEach(cleanup);

// UserMention navigates via react-router; wrap in MemoryRouter so it
// can render its <a href> without crashing.
function withRouter(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

const aliceRef: MentionRef = { username: 'alice', userId: 'u-alice' };
const bobRef: MentionRef = { username: 'bob', userId: 'u-bob' };

describe('renderTextWithMentions', () => {
  test('empty input returns empty array', () => {
    const result = renderTextWithMentions('', []);
    expect(result).toHaveLength(0);
  });

  test('text with no mentions returns single fragment', () => {
    const text = 'plain prose with no mentions';
    render(<div>{withRouter(<div>{renderTextWithMentions(text, [])}</div>)}</div>);
    expect(screen.getByText(text)).toBeTruthy();
  });

  test('renders <UserMention> for resolved username', () => {
    render(withRouter(<div>{renderTextWithMentions('hi @alice', [aliceRef])}</div>));
    // <UserMention> renders an <a href="/users/alice"> with the @alice text.
    const link = screen.getByRole('link', { name: '@alice' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/users/alice');
  });

  test('unresolved username stays plain text', () => {
    const node = withRouter(<div>{renderTextWithMentions('hi @ghost', [])}</div>);
    render(node);
    // No <a> with that name.
    expect(screen.queryByRole('link', { name: '@ghost' })).toBeNull();
    // Text content includes the @ghost verbatim.
    expect(screen.getByText(/@ghost/)).toBeTruthy();
  });

  test('mixed resolved + unresolved in same text', () => {
    const node = withRouter(
      <div>{renderTextWithMentions('cc @alice and @ghost', [aliceRef])}</div>,
    );
    render(node);
    expect(screen.getByRole('link', { name: '@alice' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '@ghost' })).toBeNull();
    // The literal "@ghost" is in the rendered DOM.
    expect(screen.getByText(/@ghost/)).toBeTruthy();
  });

  test('email-like substring does NOT match', () => {
    const node = withRouter(
      <div>{renderTextWithMentions('email foo@bar.com please', [])}</div>,
    );
    render(node);
    // Whole string is rendered as plain text.
    expect(screen.getByText(/email foo@bar\.com please/)).toBeTruthy();
  });

  test('adjacent mentions render both', () => {
    // Stress the boundary handling — without the manual scan a regex
    // with `(?:^|\W)` would consume the boundary char and skip the
    // second mention.
    const node = withRouter(
      <div>{renderTextWithMentions('cc @alice,@bob', [aliceRef, bobRef])}</div>,
    );
    render(node);
    expect(screen.getByRole('link', { name: '@alice' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '@bob' })).toBeTruthy();
  });

  test('tail text after last mention is preserved', () => {
    const node = withRouter(
      <div>{renderTextWithMentions('hello @alice and goodbye', [aliceRef])}</div>,
    );
    render(node);
    expect(screen.getByText(/and goodbye/)).toBeTruthy();
  });

  test('repeated mention of same user resolves both occurrences', () => {
    const node = withRouter(
      <div>{renderTextWithMentions('@alice and @alice again', [aliceRef])}</div>,
    );
    render(node);
    const links = screen.getAllByRole('link', { name: '@alice' });
    expect(links).toHaveLength(2);
  });

  test('null/undefined mentions array treats every match as unresolved', () => {
    const node = withRouter(
      <div>{renderTextWithMentions('hi @alice', undefined)}</div>,
    );
    render(node);
    expect(screen.queryByRole('link', { name: '@alice' })).toBeNull();
    expect(screen.getByText(/@alice/)).toBeTruthy();
  });
});
