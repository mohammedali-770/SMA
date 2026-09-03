/**
 * The PUBLIC legal page. No login, no account, no admin bundle — a store reviewer
 * opens a URL and reads the document.
 *
 * WHY IT TALKS TO PostgREST DIRECTLY instead of importing `src/lib/supabase.ts`:
 * this entry must stay tiny and must not drag the admin console's client, router
 * and design system into a page whose whole job is to render text quickly for a
 * reviewer. One `fetch` against a table with a public read policy needs no client.
 *
 * The read is anonymous by design. `legal_documents_select_public` grants `anon`
 * SELECT on `is_active` rows only, so this page can never surface a draft, and the
 * anon key it sends is a public, RLS-scoped credential (CLAUDE.md §9).
 *
 * EVERY DOCUMENT FIELD IS WRITTEN WITH textContent, NEVER innerHTML. The bodies are
 * edited by administrators in the console; rendering them as markup would turn the
 * legal editor into a stored-XSS surface on a page that is, by design, reachable by
 * anyone. Line breaks survive through CSS `white-space: pre-wrap` instead.
 */
import {
  docTitle,
  findBySlug,
  metaLine,
  orderDocs,
  pickText,
  preferredLang,
  requestFromPath,
  slugForType,
  type Lang,
  type PublicLegalDoc,
} from './legalPage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const SELECT = 'document_type,title_en,title_ar,content_en,content_ar,version,effective_date';

/**
 * Deliberately a shared interface rather than `as const`: literal types would make
 * the English and Arabic objects mutually unassignable, so `COPY[lang]` could not
 * be passed anywhere. Typing both sides identically is also what makes a missing
 * Arabic string a compile error rather than an undefined rendered to a customer.
 */
interface Copy {
  heading: string;
  intro: string;
  back: string;
  loading: string;
  failed: string;
  missing: string;
  retry: string;
  contact: string;
  other: string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    heading: 'Legal & Policies',
    intro: 'Spicy Meal — policies for the app and our restaurants.',
    back: '← All documents',
    loading: 'Loading…',
    failed: 'These documents could not be loaded right now. Please try again, or contact us below.',
    missing: 'That document is not available. Choose one from the list below.',
    retry: 'Try again',
    contact: 'Contact: info@spicymeal.com.sa · 9200 31495',
    other: 'العربية',
  },
  ar: {
    heading: 'السياسات والأحكام',
    intro: 'سبايسي ميل — سياسات التطبيق والمطاعم.',
    back: '← جميع المستندات',
    loading: 'جارٍ التحميل…',
    failed: 'تعذّر تحميل المستندات الآن. يُرجى المحاولة مرة أخرى أو التواصل معنا أدناه.',
    missing: 'هذا المستند غير متاح. اختر مستنداً من القائمة أدناه.',
    retry: 'إعادة المحاولة',
    contact: 'للتواصل: info@spicymeal.com.sa · 9200 31495',
    other: 'English',
  },
};

const LANG_KEY = 'sm-legal-lang';

function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode — the toggle still works for this page view */
  }
}

let lang: Lang = readStoredLang() ?? preferredLang(navigator.languages ?? [navigator.language]);
let docs: PublicLegalDoc[] | null = null;
let failed = false;

const app = document.getElementById('app') as HTMLElement;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    failed = true;
    render();
    return;
  }
  failed = false;
  docs = null;
  render();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/legal_documents?select=${SELECT}&is_active=eq.true`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    docs = orderDocs((await res.json()) as PublicLegalDoc[]);
  } catch {
    failed = true;
  }
  render();
}

function renderDoc(doc: PublicLegalDoc, t: Copy): void {
  const back = el('a', 'back', t.back);
  back.setAttribute('href', '/legal');
  app.append(back);
  app.append(el('h1', undefined, docTitle(doc, lang)));
  const meta = metaLine(doc, lang);
  if (meta) app.append(el('p', 'meta', meta));
  app.append(el('div', 'body', pickText(doc.content_en, doc.content_ar, lang)));
}

function renderIndex(list: PublicLegalDoc[], t: Copy): void {
  app.append(el('h1', undefined, t.heading));
  app.append(el('p', 'meta', t.intro));
  const ul = el('ul', 'docs');
  for (const doc of list) {
    const li = el('li');
    const a = el('a', undefined, docTitle(doc, lang));
    a.setAttribute('href', `/legal/${slugForType(doc.document_type)}`);
    li.append(a);
    ul.append(li);
  }
  app.append(ul);
}

function render(): void {
  const t = COPY[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  app.textContent = '';

  const toggle = el('button', 'lang', t.other);
  toggle.setAttribute('type', 'button');
  toggle.addEventListener('click', () => {
    lang = lang === 'ar' ? 'en' : 'ar';
    storeLang(lang);
    render();
  });
  app.append(toggle);

  if (failed) {
    app.append(el('h1', undefined, t.heading));
    app.append(el('p', 'notice', t.failed));
    const retry = el('button', 'retry', t.retry);
    retry.setAttribute('type', 'button');
    retry.addEventListener('click', () => void load());
    app.append(retry);
    // The ONLY place contact details are hardcoded, and it earns its place: this
    // branch runs precisely when the documents — including `contact_support` —
    // could not be read. Everywhere else the list links to that document, so
    // there is nothing here to drift out of step with the database.
    app.append(el('p', 'contact', t.contact));
  } else if (docs === null) {
    app.append(el('h1', undefined, t.heading));
    app.append(el('p', 'notice', t.loading));
  } else {
    // Resolved against the FETCHED rows, not the compiled-in registry, so a
    // document published after this build is reachable rather than a dead link.
    const req = requestFromPath(location.pathname);
    const doc = req.kind === 'doc' ? findBySlug(docs, req.slug) : undefined;
    if (req.kind === 'doc' && !doc) {
      app.append(el('p', 'notice', t.missing));
      renderIndex(docs, t);
    } else if (doc) {
      renderDoc(doc, t);
    } else {
      renderIndex(docs, t);
    }
  }
}

render();
void load();
