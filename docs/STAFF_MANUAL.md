# Staff manual — دليل الموظفين

For branch staff and managers using the Spicy Meal admin console.
للموظفين والمشرفين في الفروع.

> Each section is English first, then Arabic. Print it if that is easier.
> كل قسم بالإنجليزية ثم بالعربية.

---

## 1. The order screen — شاشة الطلبات

**Live Orders** is the screen you keep open during service. New orders arrive on
their own and play a sound. If you have muted it, you will miss orders.

Tap an order to open its receipt. Move it along with the status buttons:

`Received → Preparing → Ready → Out for Delivery → Delivered`

Pickup orders skip *Out for Delivery*. **Delivered** and **Cancelled** are final
— you cannot undo them, so be sure before you tap.

> ### ⚠️ Always read the customer note
> If an order has a **customer note**, it appears in a highlighted box above the
> items. It may say *"severe nut allergy"*. **The kitchen ticket does not carry
> this text** — you are the only person who sees it. Read it aloud to the kitchen.

**بالعربية —** شاشة **الطلبات المباشرة** هي الشاشة التي تبقى مفتوحة أثناء العمل.
تصل الطلبات الجديدة تلقائياً مع صوت تنبيه؛ إذا كتمت الصوت فسوف تفوتك طلبات.

اضغط على الطلب لفتح الفاتورة، وحرّك حالته بالأزرار:
مستلم ← قيد التحضير ← جاهز ← خرج للتوصيل ← تم التسليم.
طلبات الاستلام تتخطى "خرج للتوصيل". حالتا **تم التسليم** و**ملغي** نهائيتان ولا
يمكن التراجع عنهما.

> **⚠️ اقرأ ملاحظة العميل دائماً.** إذا كان الطلب يحتوي على ملاحظة فستظهر في مربع
> ملوّن أعلى الأصناف، وقد تكون **حساسية شديدة**. هذه الملاحظة **لا تصل إلى تذكرة
> المطبخ** — أنت الشخص الوحيد الذي يراها. اقرأها بصوت عالٍ للمطبخ.

---

## 2. An order did not print — الطلب لم يُطبع

The order is in the console but the kitchen never got a ticket.

1. Open the order and look at its **sync state**.
2. Check **Orders Requiring Verification** — orders the system could not confirm
   reach the POS land there.
3. **Do not wait.** Make the food from the screen. The customer has paid.
4. Tell your manager, with the order number.

If it keeps happening, the branch's POS mapping may be wrong — that is a manager
and admin problem, not something to fix during service.

**بالعربية —** إذا ظهر الطلب في الشاشة ولم تصل تذكرة للمطبخ: افتح الطلب وانظر
حالة المزامنة، وراجع قائمة **الطلبات التي تحتاج تحقق**. **لا تنتظر** — جهّز
الطلب من الشاشة لأن العميل قد دفع بالفعل، ثم أبلغ مشرفك برقم الطلب.

---

## 3. "I paid and got no food" — "دفعت ولم يصلني الطلب"

The most important call you will take. Do not guess.

1. Ask for the **phone number** and roughly when they ordered.
2. Find the order in **Orders**.
3. Then:
   - **Order exists and is paid** → make it, or arrange delivery. Apologise and
     give a time.
   - **Order exists and is unpaid** → the payment did not complete. Do **not**
     promise a refund; pass it to your manager.
   - **No order at all** → **escalate immediately to the manager/owner.** Money
     may have moved with no record. You cannot resolve this from the console.
4. **Never promise a refund yourself.** There is no refund button in this system;
   refunds are handled by the owner.

**بالعربية —** أهم مكالمة قد تصلك. اطلب رقم الجوال ووقت الطلب تقريباً، ثم ابحث في
**الطلبات**:
الطلب موجود ومدفوع ← جهّزه أو رتّب توصيله واعتذر مع تحديد وقت.
الطلب موجود وغير مدفوع ← الدفع لم يكتمل؛ **لا تعد بأي استرجاع** وحوّل الأمر للمشرف.
لا يوجد طلب إطلاقاً ← **بلّغ المشرف/المالك فوراً**؛ قد يكون هناك مبلغ بلا سجل.
**لا تعد بالاسترجاع أبداً** — لا يوجد زر استرجاع في النظام، والمالك هو من يتولاه.

---

## 4. Take an item off the menu — إيقاف صنف

Sold out, or the machine is broken:

**Admin → Menu → the product → mark unavailable for your branch.**

This affects **your branch only**. Customers stop seeing it immediately. Turn it
back on when you have it again — nothing does that for you.

**بالعربية —** إذا نفد صنف: **الإدارة ← المنيو ← الصنف ← إيقاف التوفر لفرعك**.
يؤثر ذلك على **فرعك فقط** ويختفي الصنف فوراً عن العملاء. أعد تفعيله بنفسك عند
توفره — لن يحدث ذلك تلقائياً.

---

## 5. Close the branch — إغلاق الفرع

**There are no opening hours in the system.** If the branch is left active, it
will take orders at 03:00 and the kitchen is empty.

- **Stop delivery only** → set *delivery temporarily closed*.
- **Stop everything** → set the branch **inactive**.

Someone must do this at **every close**, and re-open at **every open**.

⚠️ Closing does **not** cancel orders already placed. Check for in-flight orders
first and finish them.

**بالعربية —** **لا توجد ساعات عمل في النظام.** إذا بقي الفرع مفعّلاً فسيستقبل
طلبات في الثالثة فجراً والمطبخ مغلق.
لإيقاف التوصيل فقط: فعّل *إغلاق التوصيل مؤقتاً*. لإيقاف كل شيء: اجعل الفرع **غير
نشط**. يجب فعل ذلك عند **كل إغلاق** وإعادته عند **كل افتتاح**.
⚠️ الإغلاق **لا يلغي** الطلبات التي وصلت بالفعل — راجعها وأكملها أولاً.

---

## 6. The alerts inbox — صندوق التنبيهات

**Admin → Operations** shows system alerts and a daily digest.

> **Nobody is notified.** These alerts do not send an SMS, an email, or a
> notification to anyone. They only appear on this screen. **If no one opens it,
> no one knows.** Check it at the start of every shift.

**بالعربية —** **الإدارة ← العمليات** تعرض تنبيهات النظام والملخص اليومي.
**لا يصل أي إشعار لأحد** — لا رسالة نصية ولا بريد. تظهر التنبيهات في هذه الشاشة
فقط، فإذا لم يفتحها أحد لن يعلم بها أحد. **افتحها في بداية كل وردية.**

---

## 7. What you must not do — ما يجب تجنّبه

- Do not mark an order **Delivered** before it is. Reports are built on it, and
  it cannot be undone.
- Do not promise refunds, discounts or compensation. Escalate.
- Do not share your login. Your account is tied to what you change.
- Do not delete products or categories to hide them — **mark them unavailable**.
  Deleting affects every branch and loses history.

**بالعربية —** لا تضع الطلب على **تم التسليم** قبل تسليمه فعلياً — التقارير مبنية
على ذلك ولا يمكن التراجع. لا تعد بأي استرجاع أو خصم أو تعويض؛ حوّل الأمر للمشرف.
لا تشارك حسابك. ولإخفاء صنف **أوقف توفره** ولا تحذفه — الحذف يؤثر على كل الفروع
ويفقد السجل.

---

## 8. Who to call — لمن تتصل

| Situation | Who |
| --- | --- |
| Order did not print | Manager ☐ |
| Money taken, no order found | Manager → Owner ☐ |
| Console will not load / site down | ☐ |
| Anything involving a refund | Owner ☐ |

_(Fill in the names and numbers, print this page, and put it where the console is.)_
_(اكتب الأسماء والأرقام واطبع هذه الصفحة وضعها بجانب الشاشة.)_
