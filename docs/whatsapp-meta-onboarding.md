# WhatsApp — Meta onboarding pack

Everything to paste into Meta, in order. Meta requires the **account owner** to create the accounts, sign in and submit, so these steps are yours. When a step needs code or DNS on our side, it's marked **[Claude]**. Say "do step N" and it's done.

Total calendar time is roughly 1–3 weeks, and most of it is Meta's review queues.

---

## The business we register

Meta verifies a **legal entity**. The website must show the same legal name, and ours already does (the footer of the public site).

| Field | Value |
|---|---|
| Legal business name | **Lenchen Engineering (Pty) Ltd** |
| Registration number (CIPC) | 1997/008488/07 |
| VAT number | 4070166279 |
| Registered address | 716 Toermalyn Street, Moreleta Park, Pretoria, 0167, South Africa |
| Website | https://www.e-site.live |
| Business email | support@e-site.live |
| Business phone | the new WhatsApp SIM number (step 3), or another landline or mobile you control |

Customers never see the legal name in chats; they see the display name **E-Site**.

**Documents to have ready as PDFs:**
1. The CIPC registration certificate (**COR14.3** or the BizPortal equivalent) showing the name and number above.
2. A proof of address in the company's name dated within 3 months, such as a utility bill or bank statement. Meta rejects documents in a person's name.

---

## Step 1: Create the Meta Business portfolio (you)

1. Go to **business.facebook.com** and sign in with your personal Facebook or Instagram login. Meta requires a real person as admin.
2. **Create a business portfolio.** For the name, use **E-Site**; the portfolio name may differ from the legal name. Enter the business email from the table.
3. Go to **Settings → Business info** and enter the legal name, address, phone and website from the table exactly as written.

## Step 2: Business verification (you)

1. Go to **Settings → Security Centre → Start verification**.
2. Choose **South Africa**, then enter the legal name and registration number.
3. Verify the domain `e-site.live`:
   - Meta offers a DNS TXT record, a meta tag, or an HTML file. **[Claude]** can add the meta tag to the site and deploy it. Paste the tag Meta gives you into the chat.
   - Or add the DNS TXT record yourself (Google Cloud DNS).
4. Upload the two PDFs and choose email or phone confirmation.
5. Review takes a few working days. **If it's rejected**, the reason is almost always a name or address mismatch between the documents, the website and the form. Keep all three identical.

## Step 3: Get the number (you)

**It does not need to be a cellphone.** Meta requires a number that you own, with a country and area code, that can receive **one SMS or one voice call** for the verification code and is not already on WhatsApp ([Meta: business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)). After verification the number lives in Meta's cloud, so no phone or SIM has to stay on.

In order of preference:

1. **Start with Meta's free test number (no number needed).** Finishing the Cloud API "Get started" steps in step 4 creates one automatically. It sends to up to 5 verified recipients, which is enough to build and test everything end to end. Choose the real number later.
2. **An office landline**, verified by **voice call**: Meta reads the code out once. The line keeps working for normal calls, but it must not already be registered on WhatsApp.
3. **A virtual (VoIP) number** from an SA provider that can receive a voice call.
4. A prepaid SIM, used once. Least preferred: SA networks recycle prepaid numbers after long inactivity, and re-registering later needs the number.

Do **not** use the existing support WhatsApp number. Moving a number that's on the WhatsApp Business app to the API deletes its chat history. Whatever you choose, set the two-step PIN in step 4 so the number can be re-registered without the original line.

## Step 4: Create the WhatsApp Business Account (you)

1. At **developers.facebook.com → My Apps → Create app**, choose type **Business** and name it "E-Site", attached to the portfolio from step 1.
2. **Add product → WhatsApp → Set up.**
3. Go to **WhatsApp Manager → Phone numbers → Add phone number**, enter the SIM from step 3, and verify it by SMS.
4. **Display name:** `E-Site`. Meta reviews it against the website; it matches `e-site.live`.
   - **Category:** Business services.
   - **Description:** "E-Site — site management for electrical construction projects. Updates and replies about site items you're assigned to."
   - **Website:** https://www.e-site.live
   - **Email:** support@e-site.live
5. Set a **two-step verification PIN** and store it in the password manager.
6. **Payment method:** WhatsApp Manager → Settings → Payment methods → add the company card. Replies inside the 24-hour window are free; only business-initiated templates are billed.

## Step 5: Permanent access token (you)

1. **Business settings → Users → System users → Add**. Name it `esite-whatsapp`, with role **Admin**.
2. **Add assets**: the E-Site app and the WhatsApp account, with full control.
3. **Generate token**: choose the E-Site app, **Never** expire, and the permissions `whatsapp_business_messaging` and `whatsapp_business_management`.
4. **Do not paste the token into chat.** Store it in the password manager.
   - Then either set it yourself: `supabase secrets set WHATSAPP_TOKEN=… --project-ref cbskbnvvgcybmfikxgky`,
   - or put it in the macOS keychain as `esite-whatsapp-token` and **[Claude]** will set it from there without ever seeing the value.
5. Also note these, which are not secret: the **Phone number ID** and **WhatsApp Business Account ID** (WhatsApp Manager → API setup), and the **App secret** (App → Settings → Basic). The app secret *is* secret, so handle it like the token.

## Step 6: Submit the six message templates (you, or [Claude] via the API once the token is set)

WhatsApp Manager → **Message templates → Create**. Language **English**. The bodies must match exactly, because the code sends the parameters in this order.

| Name | Category | Body | Buttons |
|---|---|---|---|
| `esite_otp` | Authentication | (Meta's fixed text) `{{1}} is your verification code.` | Copy code |
| `esite_optin` | Utility | `{{1}} has invited you to receive and respond to site items for {{2}} on WhatsApp via E-Site. Your replies, photos and notes will be recorded on those items. Reply STOP at any time.` | Quick reply: `Yes, I agree` · Quick reply: `No thanks` |
| `esite_item_assigned` | Utility | `*{{1}}* · {{2}}` ⏎ `{{3}}` ⏎ `Due {{4}}` | Quick reply: `Acknowledge` · Quick reply: `Mark done` · URL: `Open in E-Site` → `https://www.e-site.live/wa/{{1}}` |
| `esite_item_due_tomorrow` | Utility | `Due tomorrow — *{{1}}* · {{2}}` ⏎ `{{3}}` ⏎ `Due {{4}}` | same three buttons |
| `esite_item_overdue` | Utility | `Overdue {{5}} days — *{{1}}* · {{2}}` ⏎ `{{3}}` ⏎ `Was due {{4}}` | same three buttons |
| `esite_items_waiting` | Utility | `You have {{1}} more E-Site items waiting for you today.` | URL: `Open E-Site` → `https://www.e-site.live/dashboard` |

Sample values for Meta's review: `{{1}}` = `SNAG-14`, `{{2}}` = `KINGSWALK`, `{{3}}` = `Loose cover on DB-3`, `{{4}}` = `Fri 3 Oct`, `{{5}}` = `2`. For the opt-in: `{{1}}` = `Thandi Nkosi`, `{{2}}` = `KINGSWALK`.

## Step 7: Webhook ([Claude] with you)

This happens after PR #221 is merged and the edge functions are deployed (`docs/whatsapp-runbook.md` §5).

1. App → WhatsApp → **Configuration → Webhook**.
   - Callback URL: `https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-webhook`
   - Verify token: the value **[Claude]** generates and sets as `WHATSAPP_VERIFY_TOKEN` (given to you then).
2. **Subscribe** to the `messages` field.

## Later: the official ≤8-person project group (sub-project 5)

This needs an **Official Business Account** (the green tick): WhatsApp Manager → Phone numbers → **Request official business account**. Meta grants it to recognisable brands, so apply only once E-Site has press, reviews or a visible public presence. There's no need to wait for it; everything else works without it.
