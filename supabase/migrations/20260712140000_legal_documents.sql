-- ============================================================================
-- Spicy Meal — legal documents & policies (admin-editable, app-readable).
--
-- One row per document type. Admins edit AR/EN title + content, version,
-- effective date, active flag, and a requires_acceptance flag from the
-- dashboard; the mobile app reads only ACTIVE documents. Purely ADDITIVE: does
-- not touch menu, orders, payments, Lazywait, WhatsApp, banners, or branches.
--
-- Security (mirrors app_settings/homepage_banners conventions):
--   - anon + customers read only ACTIVE documents.
--   - staff (admin + accountant) read all (management/preview).
--   - only admins insert/update/delete.
--
-- The seeded content below is EDITABLE PLACEHOLDER wording — generic, not legal
-- advice, and NOT reviewed by a lawyer. Admins are expected to replace it.
-- ============================================================================

create table if not exists public.legal_documents (
  id                  uuid primary key default gen_random_uuid(),
  document_type       text unique not null,
  title_ar            text not null,
  title_en            text not null,
  content_ar          text not null,
  content_en          text not null,
  version             text not null default '1.0',
  effective_date      date,
  is_active           boolean not null default true,
  requires_acceptance boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null
);

comment on table public.legal_documents is
  'Admin-editable legal/policy documents shown in the mobile app. Public reads active rows only. Seeded content is editable placeholder text, not legal advice.';

drop trigger if exists set_legal_documents_updated_at on public.legal_documents;
create trigger set_legal_documents_updated_at
  before update on public.legal_documents
  for each row execute function public.set_updated_at();

alter table public.legal_documents enable row level security;

revoke all on public.legal_documents from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;
grant insert, update, delete on public.legal_documents to authenticated;

drop policy if exists legal_documents_select_public on public.legal_documents;
create policy legal_documents_select_public on public.legal_documents
  for select to anon, authenticated
  using (is_active);

drop policy if exists legal_documents_select_staff on public.legal_documents;
create policy legal_documents_select_staff on public.legal_documents
  for select to authenticated
  using (public.is_staff());

drop policy if exists legal_documents_admin_insert on public.legal_documents;
create policy legal_documents_admin_insert on public.legal_documents
  for insert to authenticated with check (public.is_admin());

drop policy if exists legal_documents_admin_update on public.legal_documents;
create policy legal_documents_admin_update on public.legal_documents
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists legal_documents_admin_delete on public.legal_documents;
create policy legal_documents_admin_delete on public.legal_documents
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed the 9 document types with editable placeholder content (idempotent —
-- never overwrites an admin's later edits).
-- ---------------------------------------------------------------------------
insert into public.legal_documents (document_type, title_en, title_ar, content_en, content_ar) values

('privacy_policy', 'Privacy Policy', 'سياسة الخصوصية',
$en$Spicy Meal ("we", "us") respects your privacy. This page explains what we collect and how we use it.

Data we collect
- Account details: your name, phone number, and email.
- Order data: items, amounts, branch, and order history.
- Delivery location: the address and map location you choose.
- Device and usage data needed to run the app.

Why we collect it
- To create your account and sign you in.
- To prepare, deliver, and support your orders.
- To operate loyalty points and offers.
- To meet legal, tax, and accounting duties.

Payment data and Tap Payments
Card payments are processed by Tap Payments. We do not store full card numbers. Tap handles card data under its own terms and security standards.

Delivery location data
When you choose delivery, we use your selected address and map location to check coverage and deliver your order.

Phone / WhatsApp verification
If enabled, we send a one-time code by WhatsApp or SMS to verify your phone number for login and order updates.

Order and support data
We keep records of your orders and support messages so we can assist you and keep accurate records.

Third-party processors
We share only what is needed with: Supabase (app database and hosting), Tap Payments (card payments), Lazywait (branch POS / order routing), Meta / WhatsApp (phone verification and messages, if enabled), and our email/SMTP provider (transactional emails, if enabled).

Data retention
We keep personal data only as long as needed for the purposes above or as required by law (for example, tax and accounting records).

Your rights
You may ask us to: access or receive a copy of your data; correct inaccurate data; delete or destroy your data; withdraw consent where applicable; or submit a complaint. Some data may be retained where the law requires it.

Contact
To exercise any right, please contact support (see Contact & Support).$en$,
$ar$تحترم سبايسي ميل ("نحن") خصوصيتك. توضّح هذه الصفحة البيانات التي نجمعها وكيفية استخدامها.

البيانات التي نجمعها
- بيانات الحساب: الاسم ورقم الجوال والبريد الإلكتروني.
- بيانات الطلبات: الأصناف والمبالغ والفرع وسجل الطلبات.
- موقع التوصيل: العنوان والموقع على الخريطة الذي تختاره.
- بيانات الجهاز والاستخدام اللازمة لتشغيل التطبيق.

لماذا نجمعها
- لإنشاء حسابك وتسجيل دخولك.
- لتحضير طلباتك وتوصيلها ودعمها.
- لتشغيل نقاط الولاء والعروض.
- للوفاء بالالتزامات النظامية والضريبية والمحاسبية.

بيانات الدفع وبوابة Tap
تتم معالجة مدفوعات البطاقات عبر Tap Payments. نحن لا نخزّن أرقام البطاقات كاملة. تعالج Tap بيانات البطاقة وفق شروطها ومعايير الأمان الخاصة بها.

بيانات موقع التوصيل
عند اختيار التوصيل، نستخدم العنوان والموقع الذي تحدده للتحقق من نطاق التغطية وتوصيل طلبك.

التحقق عبر الجوال / واتساب
عند التفعيل، نرسل رمزاً لمرة واحدة عبر واتساب أو الرسائل النصية للتحقق من رقم جوالك لتسجيل الدخول وتحديثات الطلب.

بيانات الطلبات والدعم
نحتفظ بسجل طلباتك ورسائل الدعم لمساعدتك والاحتفاظ بسجلات دقيقة.

الأطراف الثالثة المعالِجة
نشارك القدر اللازم فقط مع: Supabase (قاعدة البيانات والاستضافة)، وTap Payments (مدفوعات البطاقات)، وLazywait (نقطة البيع وتوجيه الطلبات)، وMeta / واتساب (التحقق والرسائل عند التفعيل)، ومزوّد البريد الإلكتروني (الرسائل التشغيلية عند التفعيل).

مدة الاحتفاظ
نحتفظ بالبيانات الشخصية للمدة اللازمة للأغراض أعلاه أو حسبما يقتضيه النظام (مثل السجلات الضريبية والمحاسبية).

حقوقك
يمكنك أن تطلب: الاطلاع على بياناتك أو الحصول على نسخة منها؛ تصحيح البيانات غير الدقيقة؛ حذف بياناتك أو إتلافها؛ سحب الموافقة عند الاقتضاء؛ أو تقديم شكوى. قد يُحتفظ ببعض البيانات حيثما يتطلب النظام ذلك.

التواصل
لممارسة أي حق، يرجى التواصل مع الدعم (انظر التواصل والدعم).$ar$),

('terms_conditions', 'Terms & Conditions', 'الشروط والأحكام',
$en$These Terms govern your use of the Spicy Meal app.

- Use the app only for lawful ordering of food and related services.
- Prices, items, and availability may change and are confirmed at checkout by our system.
- Orders are subject to branch acceptance and operating hours.
- Loyalty points, coupons, and offers follow their own terms.
- We may update these Terms; continued use means you accept the current version.
- For questions, see Contact & Support.$en$,
$ar$تحكم هذه الشروط استخدامك لتطبيق سبايسي ميل.

- استخدم التطبيق فقط للطلب المشروع للطعام والخدمات المرتبطة به.
- قد تتغيّر الأسعار والأصناف والتوفر، ويتم تأكيدها عند الدفع من خلال نظامنا.
- تخضع الطلبات لقبول الفرع وساعات العمل.
- تخضع نقاط الولاء والكوبونات والعروض لشروطها الخاصة.
- قد نحدّث هذه الشروط، واستمرارك في الاستخدام يعني قبولك النسخة الحالية.
- للاستفسارات، انظر التواصل والدعم.$ar$),

('cancellation_refund_policy', 'Cancellation & Refund Policy', 'سياسة الإلغاء والاسترجاع',
$en$- You may request cancellation before the branch begins preparing your order.
- Once preparation starts, cancellation may not be possible.
- Approved refunds for card payments are returned to the original payment method via Tap Payments; timing depends on your bank.
- Cash orders are settled at the branch.
- For any refund or cancellation, contact support with your order number.$en$,
$ar$- يمكنك طلب الإلغاء قبل أن يبدأ الفرع بتحضير طلبك.
- بعد بدء التحضير قد لا يكون الإلغاء ممكناً.
- تُعاد المبالغ المستردة المعتمدة لمدفوعات البطاقة إلى وسيلة الدفع الأصلية عبر Tap Payments، ويعتمد التوقيت على البنك.
- تُسوّى الطلبات النقدية في الفرع.
- لأي استرجاع أو إلغاء، تواصل مع الدعم مع ذكر رقم طلبك.$ar$),

('delivery_pickup_policy', 'Delivery & Pickup Policy', 'سياسة التوصيل والاستلام',
$en$- Delivery is available only within a branch's coverage area and operating hours.
- Delivery fees and minimum order values are shown at checkout.
- Estimated times are approximate and may change with demand or weather.
- For pickup, collect your order from the selected branch and be ready to confirm your order number.
- Please provide accurate address and contact details to avoid delays.$en$,
$ar$- يتوفر التوصيل فقط ضمن نطاق تغطية الفرع وساعات عمله.
- تظهر رسوم التوصيل والحد الأدنى للطلب عند الدفع.
- الأوقات المقدّرة تقريبية وقد تتغيّر حسب الضغط أو الطقس.
- للاستلام، استلم طلبك من الفرع المحدد وكن مستعداً لتأكيد رقم الطلب.
- يرجى إدخال عنوان وبيانات تواصل دقيقة لتجنّب التأخير.$ar$),

('payment_policy', 'Payment Policy', 'سياسة الدفع',
$en$- Available payment methods (online card and/or cash) are shown at checkout.
- Online card payments are processed securely by Tap Payments (Mada/Visa, etc.). We never store full card numbers.
- Final amounts, including VAT, are calculated and confirmed by our system.
- Cash orders are collected at delivery or pickup.
- If a payment fails, your order may be held until payment is confirmed.$en$,
$ar$- تظهر وسائل الدفع المتاحة (بطاقة إلكترونية و/أو نقداً) عند الدفع.
- تتم معالجة مدفوعات البطاقة بأمان عبر Tap Payments (مدى/فيزا وغيرها). لا نخزّن أرقام البطاقات كاملة.
- تُحتسب المبالغ النهائية شاملة ضريبة القيمة المضافة وتؤكَّد من نظامنا.
- تُحصّل الطلبات النقدية عند التوصيل أو الاستلام.
- في حال فشل الدفع، قد يُحتجز طلبك حتى تأكيد الدفع.$ar$),

('offers_loyalty_terms', 'Offers & Loyalty Terms', 'شروط العروض والولاء',
$en$- Loyalty points are earned on eligible orders and can be redeemed for discounts.
- Point values, earning rates, and minimums may change.
- Offers and coupons may have conditions, limits, and expiry dates.
- Points and offers have no cash value and cannot be transferred.
- We may adjust or end the program with notice.$en$,
$ar$- تُكتسب نقاط الولاء على الطلبات المؤهلة ويمكن استبدالها بخصومات.
- قد تتغيّر قيمة النقاط ومعدلات الاكتساب والحدود الدنيا.
- قد تكون للعروض والكوبونات شروط وحدود وتواريخ انتهاء.
- لا تحمل النقاط والعروض قيمة نقدية ولا يمكن تحويلها.
- قد نعدّل البرنامج أو ننهيه مع إشعار مسبق.$ar$),

('account_data_deletion', 'Account & Data Deletion', 'حذف الحساب والبيانات',
$en$How to request deletion
To request deletion of your account and personal data, contact support (see Contact & Support) from your registered phone or email.

What we may retain
Some records (such as invoices and order history) may be kept where required for legal, tax, and accounting purposes, even after account deletion.

Response time
We aim to respond to deletion requests within a reasonable period (placeholder: e.g., 30 days).

Note
In this version, deletion is handled by our support team; the app does not delete accounts automatically.$en$,
$ar$كيفية طلب الحذف
لطلب حذف حسابك وبياناتك الشخصية، تواصل مع الدعم (انظر التواصل والدعم) من رقم الجوال أو البريد المسجّل.

ما قد نحتفظ به
قد يُحتفظ ببعض السجلات (مثل الفواتير وسجل الطلبات) حيثما يتطلب النظام ذلك لأغراض قانونية وضريبية ومحاسبية، حتى بعد حذف الحساب.

مدة الاستجابة
نسعى للرد على طلبات الحذف خلال مدة معقولة (قيمة مبدئية: مثلاً ٣٠ يوماً).

ملاحظة
في هذه النسخة تتم معالجة الحذف عبر فريق الدعم، ولا يحذف التطبيق الحسابات تلقائياً.$ar$),

('allergen_food_notice', 'Food Allergy Notice', 'تنبيه الحساسية الغذائية',
$en$- Our products may contain or come into contact with common allergens (such as gluten, dairy, eggs, nuts, sesame, and soy).
- Cross-contact may occur during kitchen preparation.
- Product photos are illustrative and may differ from the actual item.
- If you have a food allergy or dietary requirement, please contact the branch or support before ordering.$en$,
$ar$- قد تحتوي منتجاتنا على مسببات حساسية شائعة (مثل الجلوتين والألبان والبيض والمكسرات والسمسم والصويا) أو تتلامس معها.
- قد يحدث تلامس متبادل أثناء التحضير في المطبخ.
- صور المنتجات لأغراض التوضيح وقد تختلف عن المنتج الفعلي.
- إذا كان لديك حساسية غذائية أو متطلب غذائي، يرجى التواصل مع الفرع أو الدعم قبل الطلب.$ar$),

('contact_support', 'Contact & Support', 'التواصل والدعم',
$en$Need help? Reach our support team.

- Support email: support@example.com (edit in Admin)
- Support phone / WhatsApp: +966 5X XXX XXXX (edit in Admin)
- Hours: (edit in Admin)

For order issues, please include your order number so we can help faster.$en$,
$ar$تحتاج مساعدة؟ تواصل مع فريق الدعم.

- بريد الدعم: support@example.com (يُعدّل من لوحة التحكم)
- هاتف / واتساب الدعم: ‪+966 5X XXX XXXX‬ (يُعدّل من لوحة التحكم)
- ساعات العمل: (تُعدّل من لوحة التحكم)

بخصوص مشاكل الطلبات، يرجى ذكر رقم الطلب لمساعدتك بشكل أسرع.$ar$)

on conflict (document_type) do nothing;
