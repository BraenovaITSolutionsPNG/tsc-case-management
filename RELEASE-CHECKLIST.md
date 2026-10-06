# Release verification checklist

A single pass over the signed-in platform, after the login/loading work of
2026-10-06. Everything below is something that changed and has **not** yet been
seen running with real data.

Roughly 30–40 minutes. Do it in order — the first three matter most, because they
cover the changes with the widest blast radius.

**Before you start:** open DevTools (F12) → Network tab → tick **Preserve log**.
Leave it open the whole time. You will need it in step 2.

---

## 1. Sign in, and watch for a second load

The reported bug: the dashboard appeared, then loaded all over again.

1. Sign out if you are signed in.
2. Open `/login`. The form should be **there immediately** — no full-screen
   spinner over it.
3. Enter your credentials and press **Sign in**.
4. **Watch the button**, not the screen. It should stay greyed with a spinner
   turning, and the form should stay on screen while the platform loads.
5. The dashboard should arrive **once** and then stay.

**What went wrong before:** a spinner in the button, then a full-screen takeover
that replaced the form, then the dashboard, then a second full load of it.

**How to tell if it loaded twice:** in the Network tab you should see **one**
document request for `/` and **one** RSC fetch for it. If you see two documents,
say so — that is the regression returning, and it is the single most important
thing on this list.

**Report back:** "arrived once" / "arrived twice" / "stuck on the spinner".

---

## 2. Every protected screen, in order

Click each in the sidebar. For each one, watch for **two** things:

- **No skeleton you have to look at.** Data is prefetched, so panels should be
  already filled. A brief flash is fine; a visible skeleton that stays is not.
- **No full-screen takeover.** If the whole page is replaced by a loader, that is
  the thing we removed — it should never come back.

In order: **Overview → Case register → Reports → Administration → Settings**.

| Screen         | Watch for                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Overview       | Six figure tiles and the monitoring board all present; no red `0`                                                       |
| Case register  | The four figures across the top — **"Past their due date" must not show `0` while it is still loading or if it failed** |
| Reports        | Tab strip; weekly brief figures present                                                                                 |
| Administration | Your default tab's table with rows                                                                                      |
| Settings       | Identity panels, and "Where you're signed in" showing your device                                                       |

---

## 3. The progress bar

Only appears when a navigation is genuinely slow, which is why you will usually
not see it.

1. DevTools → Network → throttling dropdown → **Slow 3G**.
2. Click between Overview and Case register.
3. A **2-pixel teal line** should appear across the very top after a moment, then
   disappear when the screen arrives. The page underneath must not blank.
4. On a fast connection, clicking between tabs should show **nothing at all**.

If the bar appears instantly on every click, its delay is not working. If the
page goes white, something is taking over again.

---

## 4. Failure states — these are the ones that were lying

This is the part worth doing carefully, because it is what nobody finds by
accident. **The old behaviour was: a failed request looked exactly like empty
data.** On a case register that is the worst kind of wrong.

1. Keep **Preserve log** on.
2. Set throttling to **Offline**.
3. Reload the page — you will land on the sign-in screen. Go **Online** long
   enough to sign in, then set **Offline** again.
4. Now click through: Overview, Case register, Reports, Administration.

**What you should see while offline** — a clear message that it could not be
loaded, with a **Try again** button:

- Overview: "The dashboard could not be loaded"
- Case register: figures show **`—`**, not `0`, with a line saying they could
  not be counted
- Reports: "This report could not be loaded"
- Administration: "The oversight list / account list / audit trail could not be
  read" — **not** an empty table with headers and no rows

**The two failures that mattered most**, if you only remember two:

- An empty oversight table reads as _"the province has no matters."_ If you ever
  see a bare table while offline, that is a regression.
- A red `0` beside **"Past their due date"** is a claim about the province made
  from no data. If you see a `0` where you expected `—`, that is a regression.

5. Set throttling back to **No throttling**. Press the retry buttons — each
   should recover without a page reload.

---

## 5. Editing a matter

The save-on-change controls were firing twice, so a correction could silently
undo the change before it.

1. Case register → open any matter.
2. Change the **Status**. A small **"Saving"** should appear beside the field
   label, and the control should be disabled briefly.
3. In the Network tab, confirm **one** request — not two.
4. Change something else (an action, a priority) the same way.

Then check the tabs on that matter: **Matter / Activity / Referrals / File /
Brief**. Each should render its own content.

---

## 6. The quarterly report

1. Reports → the **Quarterly** tab.
2. The picker must **name a quarter** before any figures appear. If the report is
   showing under an empty dropdown, that is the bug that was fixed — tell me.
3. Change the quarter. Figures should follow the selection.

---

## 7. Two lower-priority checks

Only worth doing if you hold these roles.

**Register matter gate.** Signed in as a role _without_ `matter:register`, go to
**Register matter**. You should be refused with a reason — you should **not** be
shown a fillable, submittable form.

**Where you're signed in.** Settings → the devices panel. If that request fails
it must say the devices could not be read — it must **not** claim that the
deployment cannot manage devices.

---

## What to send back

Short is fine. The useful shape:

```
1. arrived once / twice / stuck
2. any screen that flashed a skeleton or took over
3. bar: appeared only when slow / always / never
4. offline: all clear  OR  <what you saw instead of an error>
5. one request per edit / two
6. quarter named / not named
```

Anything that does not match what is written above is worth a sentence on what
you actually saw — that is more useful than a pass/fail.
