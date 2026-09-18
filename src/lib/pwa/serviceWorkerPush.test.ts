/**
 * Behavioural tests for the REAL public/sw.js.
 *
 * A service worker cannot be imported like a module, so the file is read from
 * disk and evaluated against a stubbed ServiceWorkerGlobalScope. That keeps the
 * thing under test the file that actually ships — not a copy of its logic that
 * can drift away from it.
 *
 * The case that matters most is the malformed payload. Apple revokes a push
 * subscription that receives a message and displays nothing, so "showed the
 * wrong notification" is a smaller failure than "showed none": the second one
 * silently kills the admin's subscription.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;

interface Harness {
  listeners: Map<string, Listener>;
  shown: { title: string; options: Record<string, unknown> }[];
  focused: string[];
  opened: string[];
  navigated: string[];
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
}

const SW_SOURCE = readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf8');

function loadServiceWorker(windows: { focus: boolean; navigate: boolean }[] = []): Harness {
  const h: Harness = {
    listeners: new Map(),
    shown: [],
    focused: [],
    opened: [],
    navigated: [],
    skipWaiting: vi.fn(),
    claim: vi.fn(),
  };

  const clientList = windows.map((w, i) => {
    const client: Record<string, unknown> = { id: `client-${i}` };
    if (w.focus) {
      client.focus = () => {
        h.focused.push(`client-${i}`);
        return Promise.resolve(client);
      };
    }
    if (w.navigate) {
      client.navigate = (url: string) => {
        h.navigated.push(url);
        return Promise.resolve(client);
      };
    }
    return client;
  });

  const self = {
    addEventListener: (type: string, fn: Listener) => h.listeners.set(type, fn),
    skipWaiting: h.skipWaiting,
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        h.shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: h.claim,
      matchAll: () => Promise.resolve(clientList),
      openWindow: (url: string) => {
        h.opened.push(url);
        return Promise.resolve(null);
      },
    },
  };

  // eslint-disable-next-line no-new-func
  new Function('self', SW_SOURCE)(self);
  return h;
}

async function firePush(h: Harness, data: unknown): Promise<void> {
  const waits: Promise<unknown>[] = [];
  const event = {
    data:
      data === undefined
        ? null
        : {
            json: () => {
              if (data === '__throws__') throw new SyntaxError('not json');
              return data;
            },
          },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  };
  h.listeners.get('push')!(event);
  await Promise.all(waits);
}

describe('sw.js — push handler', () => {
  let h: Harness;
  beforeEach(() => {
    h = loadServiceWorker();
  });

  it('registers exactly the four handlers it needs, and no fetch handler', () => {
    // NO fetch handler is the safety property: a worker that cannot intercept
    // requests cannot serve a broken shell to every staff device.
    expect([...h.listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
    expect(h.listeners.has('fetch')).toBe(false);
  });

  it('shows the notification the sender asked for', async () => {
    await firePush(h, {
      title: 'فرع الناصرية أغلق حجمًا',
      body: 'زنجر — كبير',
      url: '/ops/branches/abc',
      tag: 'variant:abc',
    });
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].title).toBe('فرع الناصرية أغلق حجمًا');
    expect(h.shown[0].options.body).toBe('زنجر — كبير');
    expect(h.shown[0].options.data).toMatchObject({ url: '/ops/branches/abc' });
    expect(h.shown[0].options.tag).toBe('variant:abc');
  });

  it('defaults to Arabic and RTL, because every notification here is Arabic', async () => {
    await firePush(h, { title: 'x', body: 'y' });
    expect(h.shown[0].options.lang).toBe('ar');
    expect(h.shown[0].options.dir).toBe('rtl');
  });

  it('STILL shows a notification when the payload is not JSON', async () => {
    await firePush(h, '__throws__');
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].title).toBe('سبايسي ميل');
  });

  it('STILL shows a notification when there is no payload at all', async () => {
    await firePush(h, undefined);
    expect(h.shown).toHaveLength(1);
  });

  it('STILL shows a notification when the payload is an empty object', async () => {
    await firePush(h, {});
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].title).toBe('سبايسي ميل');
  });

  it('ignores a non-string title rather than rendering "undefined"', async () => {
    await firePush(h, { title: 42, body: null });
    expect(h.shown[0].title).toBe('سبايسي ميل');
    expect(h.shown[0].options.body).toBe('');
  });

  it('refuses an absolute or off-site url and falls back to the console root', async () => {
    // A sender that could steer the tap anywhere would be an open redirect
    // triggered by a push payload.
    for (const url of ['https://evil.example/steal', '//evil.example', 'javascript:alert(1)']) {
      const fresh = loadServiceWorker();
      await firePush(fresh, { title: 't', url });
      expect(fresh.shown[0].options.data).toMatchObject({ url: '/' });
    }
  });

  it('omits tag and renotify when the sender gives no tag, so nothing collapses', async () => {
    await firePush(h, { title: 't' });
    expect(h.shown[0].options.tag).toBeUndefined();
    expect(h.shown[0].options.renotify).toBeUndefined();
  });
});

describe('sw.js — notificationclick', () => {
  async function fireClick(h: Harness, data: unknown): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const close = vi.fn();
    h.listeners.get('notificationclick')!({
      notification: { close, data },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
  }

  it('focuses an open console window and navigates it to the target', async () => {
    const h = loadServiceWorker([{ focus: true, navigate: true }]);
    await fireClick(h, { url: '/ops/branches/abc' });
    expect(h.navigated).toEqual(['/ops/branches/abc']);
    expect(h.focused).toEqual(['client-0']);
    expect(h.opened).toEqual([]);
  });

  it('opens a new window when nothing is already open', async () => {
    const h = loadServiceWorker([]);
    await fireClick(h, { url: '/ops/branches/abc' });
    expect(h.opened).toEqual(['/ops/branches/abc']);
  });

  it('still focuses a window that cannot be navigated', async () => {
    const h = loadServiceWorker([{ focus: true, navigate: false }]);
    await fireClick(h, { url: '/x' });
    expect(h.focused).toEqual(['client-0']);
    expect(h.opened).toEqual([]);
  });

  it('falls back to the root when the notification carries no url', async () => {
    const h = loadServiceWorker([]);
    await fireClick(h, undefined);
    expect(h.opened).toEqual(['/']);
  });
});

describe('sw.js — lifecycle', () => {
  it('takes over immediately, which is safe only because it caches nothing', async () => {
    const h = loadServiceWorker();
    h.listeners.get('install')!({});
    expect(h.skipWaiting).toHaveBeenCalled();

    const waits: Promise<unknown>[] = [];
    h.listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(h.claim).toHaveBeenCalled();
  });
});
