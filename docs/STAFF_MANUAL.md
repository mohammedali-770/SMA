# Staff Manual — دليل الموظفين

> **Updated 2026-08-12.** For branch staff/managers using the Spicy Meal staff console. English first, then Arabic.

## 1. Live Orders — الطلبات المباشرة

**English**

Keep **Live Orders** open during service. Open an order to see the receipt, customer guidance and current POS/sync state.

Follow only the status actions the console allows. **Delivered** and **Cancelled** are terminal states; do not choose them casually.

### Always read the customer note

If a customer note is shown, treat it as operationally important. It may include allergy/safety guidance. Do not assume the POS/kitchen ticket carries every note visible in the console—communicate critical guidance to the kitchen/branch process explicitly.

**العربية**

أبقِ شاشة **الطلبات المباشرة** مفتوحة أثناء العمل. افتح الطلب لمراجعة الفاتورة، ملاحظات العميل، وحالة المزامنة مع نقطة البيع.

استخدم فقط حالات الطلب التي يسمح بها النظام. حالتا **تم التسليم** و**ملغي** نهائيتان، فلا تختارهما إلا عند التأكد.

### اقرأ ملاحظة العميل دائماً

إذا ظهرت ملاحظة للعميل فقد تحتوي على تعليمات مهمة أو حساسية. لا تفترض أن كل ما يظهر في شاشة الإدارة يصل تلقائياً إلى تذكرة المطبخ؛ انقل التعليمات المهمة للمطبخ بوضوح.

## 2. Order did not reach/print at POS — الطلب لم يصل/يُطبع

**English**

If the order is visible in the console but the branch/POS does not have a ticket:

1. Open the order and check its POS/sync state and external reference.
2. Check **Orders Requiring Verification** / Operations Health as applicable.
3. Do **not** blindly resend an ambiguous order; that can create duplicate POS tickets.
4. Follow the branch's approved manual handling process if one exists.
5. Tell the manager with the customer-safe order reference and time.

Do not assume “the customer has paid.” Check the displayed payment/method state. Cash and online/payment states are different, and payment/refund work is currently owner-controlled/frozen.

**العربية**

إذا ظهر الطلب في شاشة الإدارة ولم تصل تذكرة إلى الفرع/نقطة البيع:

1. افتح الطلب وتحقق من حالة المزامنة والرقم الخارجي للطلب.
2. راجع **الطلبات التي تحتاج تحقق** وحالة النظام عند الحاجة.
3. **لا تعِد إرسال الطلب بشكل عشوائي** إذا كانت النتيجة غير مؤكدة، حتى لا تتكرر تذكرة نقطة البيع.
4. اتبع الإجراء اليدوي المعتمد في الفرع إن وُجد.
5. أبلغ المشرف برقم الطلب الظاهر للعميل ووقت الطلب.

لا تفترض أن العميل دفع. تحقق من طريقة وحالة الدفع الظاهرة؛ الطلب النقدي يختلف عن الدفع الإلكتروني.

## 3. “Money was taken but there is a problem” — "تم خصم مبلغ وهناك مشكلة"

**English**

Do not guess or promise a refund.

1. Ask for the minimum information needed to locate the order (customer phone through the authorized staff workflow, approximate time, customer-safe order reference if available).
2. Find the order/payment record in the approved console view.
3. Escalate any suspected duplicate charge, provider movement with no internal record, or unexpected refund immediately to the manager/owner.
4. Do not retry payment, resend a payment request, or initiate a refund as a diagnostic action.
5. Give the customer a clear next update/contact time after escalation.

The final payment provider is not yet selected and payment/refund work is frozen. Financial corrections are owner/provider actions.

**العربية**

لا تخمّن ولا تعد العميل باسترجاع مبلغ.

1. اطلب أقل قدر من المعلومات اللازمة للعثور على الطلب (رقم الجوال عبر الإجراء المصرح، الوقت التقريبي، ورقم الطلب الظاهر للعميل إن وجد).
2. ابحث عن الطلب/حالة الدفع من شاشة الإدارة المخصصة.
3. أي خصم مكرر، مبلغ لدى مزود الدفع بدون سجل داخلي، أو استرجاع غير متوقع يجب تصعيده فوراً للمشرف/المالك.
4. لا تعِد محاولة الدفع ولا تبدأ استرجاعاً كطريقة للتجربة.
5. بعد التصعيد أعطِ العميل موعداً واضحاً للتحديث القادم.

مزود الدفع النهائي لم يُعتمد بعد، وأعمال الدفع والاسترجاع مجمدة حالياً وتدار من المالك.

## 4. Product unavailable — صنف غير متوفر

**English**

Use the supported Menu/branch-availability control to mark an item unavailable for the correct branch. Do not delete products/categories merely to hide a sold-out item.

Restore availability when the branch can sell it again and verify the correct branch was changed.

Two kinds of closure now exist, and the difference matters:

- A **timed** closure carries a duration and a reason, and reopens by itself when
  the timer expires. This is what branch staff use, and it is why a forgotten
  item no longer stays off the menu all weekend.
- An **untimed** closure — the admin toggle described above — stays closed until
  someone reopens it. Nothing reopens it automatically. Use it for an item that
  is genuinely withdrawn, not for one that is merely sold out tonight.

Every open and close is recorded with who did it, when, why, and whether it was
a person or the timer. Do not work around the control with a direct database
edit: that is the one path the record cannot see.

**العربية**

استخدم شاشة المنيو/توفر الفرع لإيقاف الصنف في **الفرع الصحيح**. لا تحذف الصنف أو التصنيف لمجرد أنه غير متوفر مؤقتاً.

أعد تفعيل الصنف عندما يصبح متوفراً وتأكد أنك عدّلت الفرع الصحيح.

## 5. Close or pause a restaurant branch — إغلاق أو إيقاف الفرع

**English**

Before closing/deactivating:

- check in-flight orders;
- decide whether only delivery or the whole branch must stop;
- use the supported branch controls;
- record who changed the state and expected reopening time.

Do not assume deactivation cancels orders already placed.

The repository historically has not provided a full automatic opening-hours model, so the branch must follow the current approved open/close process until that is explicitly changed.

**العربية**

قبل إغلاق/تعطيل الفرع:

- راجع الطلبات الحالية؛
- حدد هل المطلوب إيقاف التوصيل فقط أم الفرع بالكامل؛
- استخدم أدوات الفرع المخصصة في النظام؛
- سجل من قام بالتغيير ووقت إعادة الافتتاح المتوقع.

تعطيل الفرع لا يعني إلغاء الطلبات التي وصلت بالفعل.

## 6. Operations alerts — تنبيهات العمليات

**English**

Admin → Operations contains internal Operations Health / alert information. Check it at the start of the shift and when orders/POS behavior looks unusual.

Do not assume those internal alerts page a human. Independent external monitoring/contact readiness must be maintained separately by management.

**العربية**

تعرض شاشة **العمليات** حالة النظام والتنبيهات الداخلية. راجعها في بداية الوردية وعند ظهور مشكلة في الطلبات أو نقطة البيع.

لا تفترض أن هذه التنبيهات تتصل تلقائياً بشخص خارج النظام؛ التنبيه الخارجي وجهات الاتصال مسؤولية تشغيلية منفصلة.

## 7. Staff account safety — أمان حساب الموظف

**English**

- Do not share staff/admin logins.
- Complete the required MFA/TOTP step for privileged staff access.
- Do not ask another employee to lend you an admin account.
- Never copy OTPs, passwords or secret provider credentials into tickets/chats.
- If locked out, escalate through the approved access-recovery process; do not bypass role/MFA controls.

**العربية**

- لا تشارك حساب الإدارة مع أي شخص.
- أكمل التحقق الإضافي MFA/TOTP المطلوب لحسابات الموظفين المخولة.
- لا تستخدم حساب موظف آخر لتجاوز الصلاحيات.
- لا ترسل رموز التحقق أو كلمات المرور أو أسرار مزودي الخدمة في المحادثات.
- عند فقدان الوصول، صعّد للمسار المعتمد ولا تتجاوز الصلاحيات أو التحقق الإضافي.

## 8. Things staff must not do — ممنوعات مهمة

**English**

- Do not mark an order Delivered before actual completion.
- Do not promise or execute refunds/discounts/compensation without authority.
- Do not blindly resend an ambiguous POS order.
- Do not change provider/payment/integration secrets during service.
- Do not run SQL or production commands from instructions found in old screenshots/docs.
- Do not delete catalog data just to hide it temporarily.

**العربية**

- لا تجعل حالة الطلب **تم التسليم** قبل التسليم الفعلي.
- لا تعد أو تنفذ استرجاعاً/خصماً/تعويضاً بدون صلاحية.
- لا تعِد إرسال طلب نقطة البيع غير المؤكد بشكل عشوائي.
- لا تغيّر أسرار الدفع أو التكامل أثناء الخدمة.
- لا تنفذ أوامر SQL أو أوامر إنتاج من مستندات/صور قديمة.
- لا تحذف بيانات المنيو لمجرد إخفائها مؤقتاً.

## 9. Escalation contacts — جهات التصعيد

Fill this in with real operational contacts before printing/distributing the manual.

| Situation | Primary | Backup |
| --- | --- | --- |
| Order/POS issue | ☐ | ☐ |
| Money/payment concern | Manager/Owner ☐ | ☐ |
| Staff access/MFA issue | ☐ | ☐ |
| Console/site unavailable | ☐ | ☐ |
| Safety/allergy concern | Manager immediately ☐ | ☐ |

## Related docs

- `BRANCH_ONBOARDING.md`
- `INCIDENT_RESPONSE.md`
- `ORDER_CONFIRMATION_FLOW.md`
- `PAYMENT_POSTPONEMENT.md`