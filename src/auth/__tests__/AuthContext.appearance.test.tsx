/**
 * Row 48 — the appearance of a user (spec "Terms": a user's appearance; plan
 * "Key decisions": the appearance token).
 *
 * Expected: `appearance.seq` grows on the first answer of `/me` with a user,
 * on every successful login, on an answer of `/me` with another user, on an
 * answer of `/me` after `null`, and on the re-read of `/me` after the server
 * said the user changed; it does not grow on a repeated answer of `/me` with
 * the same user. An answer without a user leaves no appearance.
 *
 * The real `AuthProvider` with `api/auth` stubbed at the module boundary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { User } from '../../api/auth';

const meApi = vi.fn();
const loginApi = vi.fn();

vi.mock('../../api/auth', () => ({
  meApi: (...args: unknown[]) => meApi(...args),
  loginApi: (...args: unknown[]) => loginApi(...args),
  logoutApi: vi.fn(async () => ({})),
  getAuthConfig: vi.fn(async () => ({ mode: 'local', logoutRedirectUrl: null })),
}));

vi.mock('../../components/Toaster', () => ({
  toaster: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { AuthProvider, ME_KEY, useAuth } from '../AuthContext';
import { reloadMeAfterUserChanged } from '../appearance';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function user(id: string): User {
  return {
    id,
    email: `${id.slice(0, 4)}@example.test`,
    username: `u-${id.slice(0, 4)}`,
    name: 'User',
    role: 'user',
    createdAt: null,
    lastLoginAt: null,
  };
}

type Auth = ReturnType<typeof useAuth>;

function mount(): { client: QueryClient; auth: () => Auth; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let latest: Auth | null = null;
  function Probe() {
    latest = useAuth();
    return null;
  }
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    auth: () => {
      if (latest === null) throw new Error('the provider has not rendered');
      return latest;
    },
    unmount,
  };
}

async function refetchMe(client: QueryClient): Promise<void> {
  await act(async () => {
    await client.refetchQueries({ queryKey: ME_KEY, exact: true });
  });
}

let view: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('row 48 — appearance.seq', () => {
  test('the first answer of /me with a user is an appearance; a repeated answer with the same user is not', async () => {
    meApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const first = view.auth().appearance!;
    expect(first.userId).toBe(A);

    await refetchMe(view.client);
    expect(meApi).toHaveBeenCalledTimes(2);
    expect(view.auth().appearance).toEqual(first);
  });

  test('every successful login grows seq, the same user included', async () => {
    meApi.mockResolvedValue(user(A));
    loginApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const before = view.auth().appearance!.seq;

    await act(async () => {
      await view!.auth().login({ email: 'a@example.test', password: 'p' });
    });
    const afterFirst = view.auth().appearance!;
    expect(afterFirst.userId).toBe(A);
    expect(afterFirst.seq).toBeGreaterThan(before);

    await act(async () => {
      await view!.auth().login({ email: 'a@example.test', password: 'p' });
    });
    expect(view.auth().appearance!.seq).toBeGreaterThan(afterFirst.seq);
  });

  test('/me with another user grows seq', async () => {
    meApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const before = view.auth().appearance!.seq;

    meApi.mockResolvedValue(user(B));
    await refetchMe(view.client);
    const after = view.auth().appearance!;
    expect(after.userId).toBe(B);
    expect(after.seq).toBeGreaterThan(before);
  });

  test('/me without a user leaves no appearance; /me with the same user after null grows seq', async () => {
    meApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const before = view.auth().appearance!.seq;

    meApi.mockResolvedValue(null);
    await refetchMe(view.client);
    expect(view.auth().appearance).toBeNull();

    meApi.mockResolvedValue(user(A));
    await refetchMe(view.client);
    const after = view.auth().appearance!;
    expect(after.userId).toBe(A);
    expect(after.seq).toBeGreaterThan(before);
  });

  test('/me with the same user after the page wrote null (a 401) grows seq', async () => {
    meApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const before = view.auth().appearance!.seq;

    act(() => {
      view!.client.setQueryData(ME_KEY, null);
    });
    await refetchMe(view.client);
    const after = view.auth().appearance!;
    expect(after.userId).toBe(A);
    expect(after.seq).toBeGreaterThan(before);
  });

  test('the re-read of /me after "user changed" grows seq, even when it names the same user', async () => {
    meApi.mockResolvedValue(user(A));
    view = mount();
    await waitFor(() => expect(view!.auth().appearance).not.toBeNull());
    const before = view.auth().appearance!.seq;

    await act(async () => {
      await reloadMeAfterUserChanged();
    });
    expect(meApi).toHaveBeenCalledTimes(2);
    const after = view.auth().appearance!;
    expect(after.userId).toBe(A);
    expect(after.seq).toBeGreaterThan(before);

    // The next ordinary re-read is not an appearance again.
    await refetchMe(view.client);
    expect(view.auth().appearance).toEqual(after);
  });
});
