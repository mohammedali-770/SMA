/**
 * Runs the REAL payment Edge Function handlers inside Vitest.
 *
 * A handler module calls `Deno.serve` when it is imported and builds its
 * Supabase clients through `_shared/supabaseClient.ts`, which imports
 * supabase-js from an `npm:` specifier Vite cannot resolve. So a test file
 * that uses this mocks `./supabaseClient.ts` to hand out the fake database
 * (see paymentFakes.ts), and this module provides the rest: a `Deno` with
 * just `env` and `serve`, the captured handlers, and Moyasar behind `fetch`.
 *
 *   vi.mock('./supabaseClient.ts', () => ({
 *     adminClient: () => currentDb().client(),
 *     userClient: () => currentDb().client(),
 *   }));
 */
import { FakeMoyasar, FakePaymentDb } from './paymentFakes.ts';

export type Handler = (req: Request) => Promise<Response>;
type Name = 'payment-initiate' | 'payment-verify' | 'payment-webhook';

const g = globalThis as Record<string, unknown>;
const handlers = new Map<Name, Handler>();
let captured: Handler | null = null;

g.Deno = {
  env: { get: (key: string) => (key === 'SUPABASE_URL' ? 'https://project.example' : undefined) },
  serve: (h: Handler) => {
    captured = h;
    return { finished: Promise.resolve(), shutdown() {} };
  },
};

let db = new FakePaymentDb();
let moyasar = new FakeMoyasar();

/** A fresh database and Moyasar for the next test, both returned. */
export function freshRuntime(): { db: FakePaymentDb; moyasar: FakeMoyasar } {
  db = new FakePaymentDb();
  moyasar = new FakeMoyasar();
  g.fetch = moyasar.fetch;
  return { db, moyasar };
}

export function currentDb(): FakePaymentDb {
  return db;
}

async function load(name: Name): Promise<Handler> {
  const have = handlers.get(name);
  if (have) return have;
  captured = null;
  if (name === 'payment-initiate') await import('../../payment-initiate/index.ts');
  else if (name === 'payment-verify') await import('../../payment-verify/index.ts');
  else await import('../../payment-webhook/index.ts');
  const h = captured as Handler | null;
  if (!h) throw new Error(`${name} did not call Deno.serve`);
  handlers.set(name, h);
  return h;
}

export interface Reply {
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;
}

/** POST a JSON body to a handler as a signed-in customer, and read the answer. */
export async function call(name: Name, body: unknown): Promise<Reply> {
  const h = await load(name);
  const res = await h(
    new Request(`https://project.example/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer customer-jwt' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

/** Deliver a Moyasar webhook for a payment, as Moyasar would. */
export function webhook(payment: Record<string, unknown>, type = 'payment_paid'): Promise<Reply> {
  return call('payment-webhook', {
    id: `evt_${String(payment.id)}_${type}`,
    type,
    live: true,
    secret_token: 'whsec_live_fixture',
    data: payment,
  });
}
