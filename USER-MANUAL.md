# USER MANUAL — TSC Provincial Matters platform

The operating manual for every person who uses this system. Written to be read
once, top to bottom, and then kept as a reference.

**Who this is for:** every officer, from the Provincial Matters Officer who
registers a matter on Monday morning to the Platform Administrator who manages
accounts. Sections marked **[role]** only apply to you if you hold that role.

Every rule quoted here is enforced by the system itself. Where this manual says
"the system will refuse", it means a refusal you cannot talk your way past —
which is a feature. The Golden Rule exists because matters used to go unregistered,
unactioned, unfollowed-up and closed with nothing recorded. The platform makes
each of those impossible rather than merely discouraged.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [The five screens everyone has](#2-the-five-screens-everyone-has)
3. [Registering a matter](#3-registering-a-matter)
4. [Working a matter](#4-working-a-matter)
5. [Referring a matter](#5-referring-a-matter)
6. [Building the case file](#6-building-the-case-file)
7. [Closing a matter](#7-closing-a-matter)
8. [The case brief](#8-the-case-brief) **[Professional Assistant]**
9. [The monitoring board](#9-the-monitoring-board) **[Professional Assistant]**
10. [The reporting set](#10-the-reporting-set) **[Assistant and above]**
11. [Oversight and accounts](#11-oversight-and-accounts) **[Administrator]**
12. [Reference tables](#12-reference-tables)
13. [When something is refused](#13-when-something-is-refused)

---

## 1. Before you start

### Signing in

Go to `/login` and enter the **email address and password** issued to you by the
platform administrator.

Two things to know:

- **Accounts are created by an administrator, not by you.** There is no "create
  account" link, and there will not be one. If you need an account, ask.
- **"Remember sign in details"** keeps your email address on that device so you do
  not have to type it. **It never stores your password.**

### If your password is accepted but you are not let in

This is not a mistake and not your password. Supabase confirms who you are, and
then the platform checks whether your account is set up and active. Three
different things can happen, and they need different people to fix them:

| What you see                             | What it means                                  | Who fixes it              |
| ---------------------------------------- | ---------------------------------------------- | ------------------------- |
| "This account has not been set up"       | Supabase knows you, but no account exists here | Platform administrator    |
| "This account has been deactivated"      | The account exists but has been switched off   | Platform administrator    |
| "The platform cannot reach its database" | The system is broken — **not** your account    | Whoever runs the platform |

The distinction is deliberate. "Show the sign-in form again" would tell an officer
who has just typed a correct password that their password was wrong.

### Signing out

Use **Sign out** from the sidebar, or from **Settings → Your account**. The
platform's branded screen covers the sign-out rather than the page changing under
you — which matters most on a shared machine. You land on `/login`.

### Finding things quickly

- **The sidebar** shows only the screens your role can actually use. If something
  is missing, you do not have the role for it — that is not a fault.
- **Press ⌘K** (Ctrl+K on Windows and Linux) for the same list as a searchable
  command palette.
- **The sidebar width is remembered per browser.** Drag the right-hand edge to
  resize; your choice stays on this device.

---

## 2. The five screens everyone has

### 2.1 Overview (`/`)

Your landing page. Four figures, each a link into the matters behind it:

| Figure                      | Meaning                                       |
| --------------------------- | --------------------------------------------- |
| **Matters on the register** | Every matter in the province, open and closed |
| **Past their due date**     | Open matters whose due date has passed        |
| **Due within seven days**   | Open matters approaching their deadline       |
| **Not yet picked up**       | Registered but with no assigned officer       |

**Read the register-wide figures as "how is the province doing".** They are
counted across the whole province, separately from any filter you have applied.
That is deliberate: a filter that hid overdue matters must not make the province
look like it has none.

### 2.2 Case register (`/cases`)

The working list. It shows **every** matter in the province — it is not a personal
queue, and it opens unfiltered so you never have to guess which filter is hiding
something.

**Search** by **case number or teacher's name** — whichever you have. An officer
looking for "the Kava matter" and an officer looking for a reference are looking
for the same row. The search is case-insensitive, and waits until you stop typing.

**Filters** (click _Filters_ to reveal them): **Status**, **Matter type**,
**Province**, and a **Past due date only** checkbox. Changing any filter returns
you to page 1, so the four filters cannot behave inconsistently with each other.
_Clear all_ resets everything at once.

**Paging** is 25 rows at a time.

If you are on the last page and a matter written from another screen is closed
while you sit there, the register corrects the page for you rather than showing
you an empty table.

### 2.3 A matter (`/cases/{id}`)

Five tabs:

| Tab            | What is on it                                               |
| -------------- | ----------------------------------------------------------- |
| **The matter** | Every field, the status control, and the action             |
| **Activity**   | The full history: every change, who made it, when           |
| **Referrals**  | Outbound referrals and the responses received               |
| **File**       | Uploaded documents, grouped by class                        |
| **Case brief** | The short report for the Director **[Assistant and above]** |

The **At a glance** panel shows class of matter, province, date received,
assigned officer, due date, escalation level, and which section it is with. A due
date in **red** means it has passed.

### 2.4 Reports (`/reports`) — see §10

### 2.5 Settings (`/settings`)

**Your account** — your details, and your avatar. Avatars must be PNG, JPEG or
WebP, 2 MB or smaller. The image is checked by its actual contents, not its
filename, so a renamed script is refused.

**Password** — change it, or reset it by email if you have forgotten it. If your
account signs in through the Commission's identity provider rather than a local
password, the screen says so and there is nothing to change.

**Appearance** — light or dark. **This is stored in your browser only**, on
purpose: two officers sharing a machine in a provincial office should not be
fighting over each other's screen.

---

## 3. Registering a matter

**Golden Rule part 1: no teacher matter received without being registered.**

Register the matter on the day it arrives. This applies to anything a teacher
puts in front of you about their own employment — a query, a complaint, a letter.

Go to **Register matter** (`/cases/new`).

### Worked example

A teacher writes on 5 March 2026 about three months of unpaid acting-allowance
allowance. You receive it on 6 March 2026.

| Field                     | Enter                                                                                                | Why                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Date received**         | 6 March 2026                                                                                         | When _you_ received it — not when she wrote it. This starts the clock on delay. |
| **Province**              | The province where she is posted                                                                     | Decides which office handles it                                                 |
| **Teacher's name**        | As spelled on her official record                                                                    |                                                                                 |
| **Employee reference**    | If known                                                                                             | Optional, but it saves hunting later                                            |
| **Class of matter**       | Industrial and General                                                                               | Salary, allowances and conditions of service                                    |
| **Summary of the matter** | "Teacher claims three months of acting allowance not paid. Requests payment and a written response." | One or two sentences. This is what the Director reads first.                    |
| **Assigned officer**      | Leave blank to take it yourself                                                                      | Defaults to you                                                                 |
| **Due date**              | 3 April 2026                                                                                         | **Required** — see below                                                        |
| **Action required**       | "Verify payment records for Feb–Apr 2025; respond in writing."                                       | **This is the Golden Rule part 2 anchor.**                                      |
| **Priority**              | Normal, or Urgent                                                                                    | Urgent for anything a teacher is treating as urgent                             |

### The two fields that matter most

**The due date is required.** A matter with no deadline cannot appear in the delay
or overdue figures, cannot be escalated for delay, and will simply sit. The system
will refuse to register a matter without one. If a matter genuinely has no natural
deadline, pick a review date — a month out is normal — and change it later when you
know more.

**The action required is not bookkeeping.** Without it, the matter cannot move
beyond _Newly received_: the system refuses any status change that advances it.
This is the second limb of the Golden Rule, and it is why the action is asked for
at registration rather than discovered later.

### What you get

The system assigns a **case number** — the year, then a sequence, such as
`2026/0007`. Quote it in correspondence. It is permanent.

The matter now sits at **Newly received** and appears in the _Not yet picked
up_ list on the Overview until it has an assigned officer.

---

## 4. Working a matter

Open the matter and use the **Status** control. Eleven stages:

`Newly received` → `Verification required` → `Investigation in progress` →
`Referred to National Section (HQ)` → `Awaiting advice` → `Awaiting decision` →
`With Legal Section` → `Action being implemented` → `Escalated due to delay` →
`Resolved` → `Closed`

### Worked example — working a complaint

Your acting-allowance matter, `2026/0007`, sits at _Newly received_.

1. **Assign it and set the action.** You are the officer, so the Officer field is
   you. Confirm the action is recorded — the panel turns red and warns you if it
   is empty.
2. **Move to `Verification`.** Read the payment records. Type what you found into
   the **Activity** note and attach the ledger extract to the **File** as
   _Relevant records_.
3. **Move to `Investigation`.** The ledger shows the allowance was approved but
   never paid. Note that, attach the approval memo as _Relevant records_.
4. **Move to `Advice sought` or `Referred`** — see §5.

**Every change is recorded.** Status changes, notes, attachments and referrals all
appear in **Activity** with your name and the time. This is not optional and
cannot be switched off: it is the accountability trail, and the audit screen and
the Golden Rule report are both built from it.

### Escalation

Escalation is a **level**, separate from status, so you can be waiting on a
National Section at level 3 while the status still says `Verification`.

| Level | Who it is with                                                 |
| ----- | -------------------------------------------------------------- |
| 0     | You, the responsible officer                                   |
| 1     | Senior / Regional officer                                      |
| 2     | Director, Provincial Matters                                   |
| 3     | Relevant National Section                                      |
| 4     | Commissioner / Management                                      |
| 5     | Commission                                                     |
| 6     | Legal Section — runs alongside the others, not instead of them |

Set the level when you escalate, and **name the reason in the Activity note**.
Raising a level with no note gives the next person nothing.

---

## 5. Referring a matter

**Referral is the officer's judgement.** If a matter is outside your authority,
referring it is not an escalation of failure — it is the correct act, and only you
and the Director can make it. It is also the reason the Professional Assistant
cannot refer anything: see §8.

### What you must supply

A referral **cannot be created without a response deadline**. This is Golden Rule
part 3 — there is no state in which a matter is referred and nobody is obliged to
chase it.

### Worked example

Your acting-allowance matter needs a ruling on entitlement to acting allowance
during a posting. That is Appointments' authority, not yours.

1. Open the matter → **Referrals** tab → **Refer this matter**.
2. **Destination: Appointments.**
3. **Reason:** "Entitlement to acting allowance during acting posting is outside
   the officer's delegated authority."
4. **Criteria** — tick every one that applies. The options are:
   - It is outside the officer's delegated authority
   - It requires a decision by the Commission
   - It involves interpretation of legislation
   - It involves a dispute over a statutory entitlement
   - It involves a formal appointment appeal
   - It involves a significant industrial dispute
   - It involves threatened or actual court proceedings
   - A lawyer's letter has been served
   - The matter involves judicial review
   - There is uncertainty about the applicable law or policy
   - The matter has potential financial or legal implications for the Commission
5. **Response due date:** pick it with the section, not for them. Two weeks is
   typical.
6. **Director notified:** record who in the Director's office knows about this, if
   applicable.

The matter moves to `Referred` at escalation level 3, and appears in _Referred
and awaiting response_ on the monitoring board.

### Industrial and General matters need four statements

If the class is **Industrial and General**, the dialog asks for four statements
and the server **refuses the referral without all four**:

1. **What the teacher is claiming** — in her words, not paraphrased away
2. **What the province verified** — what you actually checked, and what you found
3. **What remains unresolved** — the honest gap
4. **What decision or advice is required** — the specific question put to the
   section

_Example:_ _"Teacher claims acting allowance unpaid for three months. Province
verified the allowance was approved in February but no payment appears on the
ledger. Unresolved: whether the payment failed or was never processed. Required:
a ruling on entitlement to acting allowance during an acting posting."_

### Legal matters go to the Legal Section

If you tick any of the legal criteria — interpretation of legislation, a statutory
entitlement dispute, court proceedings, a lawyer's letter, judicial review, or
uncertainty about the applicable law — the system refers it as a **legal
referral** at level 6, regardless of the matter class.

**Do not offer your own legal opinion in a note.** Record the facts and refer. §6
makes legal matters a distinct path precisely so that provincial officers are not
expected to interpret legislation.

### Receiving a response

When a section responds, record it on the **Referrals** tab: the date received, who
from the section answered, and the advice or outcome. The referral stops being
_pending_ only when you do this — so if you never record it, the monitoring board
will keep telling you it is outstanding, which is the point.

---

## 6. Building the case file

The **File** tab is the evidence. Every item is typed, because a folder of
unnamed attachments cannot be audited.

### Accepted formats

PDF, PNG, JPEG, WebP, Word (`.doc` / `.docx`), Excel (`.xls` / `.xlsx`), and plain
text. **10 MB maximum.**

### The eleven document classes

**Four must be present before the matter can be closed:**

- **Original application / query** — what the teacher actually sent you
- **Decisions** — what was decided, by whom
- **Evidence of communication to the teacher** — proof she was told
- **Closure record** — the closing note

**Seven are optional but expected:**

- Supporting documents
- Correspondence received
- Correspondence sent
- Investigation notes
- Relevant records
- Referral letter
- Advice received

### Worked example

For `2026/0007`, upload as you go rather than at the end:

| When                | Class                                    | Item                            |
| ------------------- | ---------------------------------------- | ------------------------------- |
| At registration     | Original application / query             | Her letter of 5 March           |
| After verification  | Relevant records                         | February payment ledger extract |
| After investigation | Relevant records                         | Allowance approval memo         |
| On referral         | Referral letter                          | The referral to Appointments    |
| On response         | Advice received                          | Appointments' written advice    |
| Before closing      | Decisions                                | The decision taken              |
| Before closing      | Evidence of communication to the teacher | Letter to her, 2 June 2026      |
| Before closing      | Closure record                           | Closing note                    |

Uploading as you work is not just tidier — you will not be able to reconstruct
which extract came from which ledger at 4pm on the day you need to close.

---

## 7. Closing a matter

**Golden Rule part 4: no matter closed without a recorded outcome.**

Setting the status to **Resolved** or **Closed** opens a closure form instead of
saving directly. All three fields are required:

| Field                                  | Example                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Outcome / decision or advice given** | "Acting allowance confirmed payable for the period. Payment to be processed by the Commission, and the teacher advised in writing on 2 June 2026." |
| **Date closed**                        | Defaults to today. Change it only if you are genuinely recording an earlier closure.                                                               |
| **Communicated to the teacher by**     | The officer who actually conveyed it. Not you, if someone else did.                                                                                |

The button stays disabled and says _"All three are required before the matter can
be closed"_ until all three are filled in.

`Resolved` and `Closed` both end the matter. Use **Resolved** when the outcome is
settled; use **Closed** when the file is also complete.

### Worked example

Your acting-allowance matter is settled:

1. Upload the last four required documents (§6). The **File** tab will tell you
   which are missing.
2. Move the status to **Closed**.
3. Fill in the three fields above.
4. Click **Close matter**.

The matter leaves the caseload. It stays on the register forever, and it still
counts in the reporting set.

### You cannot close a matter you have not given an action to

If the action is empty, the closure is refused. This is Golden Rule parts 2 and 4
working together: an unactioned matter cannot be quietly made to disappear.

---

## 8. The case brief

_Applies to the Professional Assistant and above._

Before a matter goes to the Director, a short case report is prepared. Four
sections always apply:

| Section              | Hint                       | In practice                                 |
| -------------------- | -------------------------- | ------------------------------------------- |
| **Issue**            | What is the problem        | One sentence. The Director reads this first |
| **Background**       | What happened              | The chronology, plainly                     |
| **Action taken**     | What has already been done | Steps completed, documents obtained         |
| **Current position** | Where is the matter now    | Where it is stuck, and on whom              |

### Two more sections, conditionally required

If the matter is **flagged for the Director's attention** _or_ already sits at
`Awaiting decision`, these become **mandatory** and the system refuses to save the
brief without them:

| Section                      | Hint                                  |
| ---------------------------- | ------------------------------------- |
| **Issue requiring decision** | What does the Director need to decide |
| **Recommendation**           | What action is proposed               |

The reason is simple and is enforced deliberately: a brief that asks the Director
to decide something, without saying what the decision is about, is worse than no
brief at all. A matter at `Awaiting decision` counts as asking for a decision by
its status whatever the flag says — so you cannot escape this by not ticking the
flag.

### Worked example

For `2026/0007`, once Appointments' advice arrives:

- **Issue:** "Entitlement to acting allowance during a three-month acting posting."
- **Background:** "Teacher wrote 5 March 2026 claiming three months' acting
  allowance unpaid. Received 6 March 2026 and registered the same day."
- **Action taken:** "Payment ledger verified — allowance approved February 2026,
  no payment recorded. Approval memo obtained. Referred to Appointments
  [date]; response received [date]."
- **Current position:** "Awaiting Commission payment processing. Teacher advised
  in writing 2 June 2026."
- **Issue requiring decision:** "Whether the delay in processing an approved
  entitlement is a matter for the Director's intervention."
- **Recommendation:** "That the Director ask the Commission for a payment date,
  and that the teacher be told the date once it is confirmed."

---

## 9. The monitoring board

_Applies to the Professional Assistant._

Your daily screen. Seven lists, in the order the manual gives them — each showing
the actual matters, not a count, because a number you cannot click into is no use
at 8am:

1. **New matters** — registered, nobody has picked them up
2. **Outstanding matters** — held by the province
3. **Delay matters** — past the due date
4. **Legal matters** — with the province's legal advisers
5. **Awaiting National Section** — referred out, response outstanding
6. **Requiring the Director's attention** — flagged, plus anything already at
   `Awaiting decision`
7. **Case briefs to prepare** — matters needing a brief, that do not have one

### Your daily round

1. **New matters** — allocate each one an officer and confirm an action.
2. **Delay matters** — chase, and escalate the level if it is going nowhere.
3. **Awaiting National Section** — check which are past their response deadline
   and follow up. _Waiting days counts from the oldest outstanding referral_, so a
   matter with two referrals shows the one that has waited longest — that is the
   one to chase.
4. **Requiring the Director's attention** — make sure each of these has a brief ready.
5. **Case briefs to prepare** — write them.

### Your other jobs

- **Flag a matter for the Director** when it needs their decision. Only your role
  holds this; no other tier uses it.
- **Record a National Section's response** when it arrives (§5).
- **Produce the reporting set** (§10).

---

## 10. The reporting set

_Applies to the Professional Assistant and above._

Five tabs on **Reports**. Every figure is counted from the register at the moment
you run it — so if a number looks wrong, the register is wrong, and the fix is to
update the register rather than to query the report.

| Tab              | What it answers                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **Weekly brief** | The one-page Director's brief — new, outstanding, delayed, legal, awaiting response, awaiting decision      |
| **Monthly**      | One month against the previous, with province, class and status breakdowns                                  |
| **Quarterly**    | One quarter against the previous: intake, closures, closure rate, median days to close, officer performance |
| **Officers**     | Per-officer load, escalations, overdue count, closure rate                                                  |
| **Golden Rule**  | The register measured against all four limbs                                                                |

### Reading the comparisons honestly

- **Closure rate** is "closed ÷ received", for the period. It is not a judgement of
  any officer.
- **Median days to close** is a median, so one very old matter does not distort it.
- **Officer performance** credits the officer who **registered** the matter, not
  whoever holds it now. Work handed over is still work that was done.
- The monthly report's **by status** panel is the whole province, deliberately —
  it answers a standing question, not a question about the month.

### Using the period pickers

Pick a month or quarter, or leave it blank for the current one. The comparative
figures ("up from", "no change on") always compare with the immediately preceding
period.

### What to do with the Golden Rule tab

Any limb not showing full compliance is a **matter to fix, not a matter to report
around.** Find the matters behind the number, and go and update them. The report
exists to tell you where the register is not telling the truth yet.

---

## 11. Oversight and accounts

### 11.1 The oversight list **[Administrator and above]**

**Administration → Oversight** shows every matter in the register regardless of
assigned officer. Two things you can change:

- **Reassign** an officer from the picker on each row.
- **Override the status.**

Both write to the audit trail with your name and **require a reason**. There is no
way to change a matter's owner or stage anonymously — that is the point of an
oversight screen.

### 11.2 Accounts **[Platform administrator only]**

**Administration → Users**. Create an account, change a role, deactivate, reset a
username, delete.

**Creating an account** creates both halves at once: the Supabase identity that
holds the password, and the local row this platform uses. Passwords are never
visible to this application and cannot be read back — that is why a forgotten
password is _reset_, never recovered.

### Two guards, and the reasoning behind them

**Deleting an officer is refused if they appear in the accountability trail.** The
screen tells you exactly how many matters they registered, how many were assigned
to them, how many actions they recorded, how many referrals, and how many file
items — and then advises you to **deactivate** instead. Deactivation closes the
sign-in immediately and keeps the record, which is what the audit trail needs. A
deleted officer leaves holes in the history of matters that are still live.

**The last active platform administrator cannot be deleted or demoted.** The
platform has to remain manageable by someone.

### 11.3 The audit trail **[Platform administrator only]**

**Administration → Audit trail**: every recorded action on the platform, with
actor, action, matter and time. Searchable and filterable, and filtered **in the
database** — so searching for an action from eight months ago finds it instead of
paging through the newest events.

This is where you answer "who changed this, and when".

### 11.4 Statistics **[Platform administrator only]**

Register totals, overdue rate, and a twelve-month intake chart.

---

## 12. Reference tables

### The eleven statuses

Each status has a full label and a short one for dense tables and badges.

| Code  | Full label                        | Short label        | Use it when                            |
| ----- | --------------------------------- | ------------------ | -------------------------------------- |
| `NEW` | Newly received                    | New                | Just filed. Nothing decided            |
| `VER` | Verification required             | Verification       | Checking the facts against the record  |
| `INV` | Investigation in progress         | Investigation      | Enquiry under way                      |
| `REF` | Referred to National Section (HQ) | Referred           | With a National Section                |
| `ADV` | Awaiting advice                   | Awaiting advice    | Advice requested, waiting on it        |
| `DEC` | Awaiting decision                 | Awaiting decision  | The Director's decision is outstanding |
| `LEG` | With Legal Section                | Legal              | With legal advisers                    |
| `ACT` | Action being implemented          | Action in progress | The decision being carried out         |
| `ESC` | Escalated due to delay            | Escalated          | Escalated, usually for delay           |
| `RES` | Resolved                          | Resolved           | Finished, outcome recorded             |
| `CLS` | Closed                            | Closed             | Finished and formally closed           |

**Resolved and Closed are the only two that end a matter.** Everything else is open
and counts as outstanding.

### The four Golden Rule parts

| Part | Rule                                                | What enforces it                                          |
| ---- | --------------------------------------------------- | --------------------------------------------------------- |
| 1    | No teacher matter received without being registered | The registration form requires it at the point of receipt |
| 2    | No registered matter without an assigned action     | Any status change that advances the matter                |
| 3    | No referred matter without follow-up                | A referral cannot be created without a response deadline  |
| 4    | No matter closed without a recorded outcome         | Closure needs outcome + date + communication record       |

### Who can do what

|                                   | Officer | Assistant | Director | Administrator | Platform admin |
| --------------------------------- | :-----: | :-------: | :------: | :-----------: | :------------: |
| See the whole provincial register |    ●    |     ●     |    ●     |       ●       |       ●        |
| Register a matter                 |    ●    |     ●     |    ●     |       ●       |       ●        |
| Update a matter                   |    ●    |     ●     |    ●     |       ●       |       ●        |
| Escalate                          |    ●    |     ●     |    ●     |       ●       |       ●        |
| **Refer to a National Section**   |    ●    |     —     |    ●     |       ●       |       ●        |
| **Record a decision**             |    —    |     —     |    ●     |       ●       |       ●        |
| **Flag for the Director**         |    —    |     ●     |    —     |       —       |       ●        |
| **Record a section's response**   |    ●    |     ●     |    —     |       —       |       ●        |
| Prepare a case brief              |    ●    |     ●     |    ●     |       ●       |       ●        |
| Add to the case file              |    ●    |     ●     |    ●     |       ●       |       ●        |
| Read the reporting set            |    —    |     ●     |    ●     |       ●       |       ●        |
| Oversight list and reassignment   |    —    |     —     |    —     |       ●       |       ●        |
| Manage accounts                   |    —    |     —     |    —     |       —       |       ●        |
| Global audit trail                |    —    |     —     |    —     |       —       |       ●        |
| System statistics                 |    —    |     —     |    —     |       —       |       ●        |

The three gaps are deliberate, not oversights:

- **Only officers, the Director and above can refer.** Deciding that a matter is
  outside provincial authority is the officer's judgement.
- **Only the Director and above can decide.**
- **Only the Professional Assistant flags.** The flag is their instrument for
  putting a matter in front of the Director.
- **The reporting set starts at the Assistant**, because the Assistant prepares
  the reports. The Director receives them.

If you try something you cannot do, the screen will not offer it. If it is
offered and then refused, that is a rule — see §13.

---

## 13. When something is refused

The system refuses things. It is not obstructive; it is the Golden Rule. Here is
every refusal you are likely to meet, and what to do about it.

| Refusal                                                        | Why                                                                                                | What to do                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| _"Register a matter"_ — not offered                            | Your role does not hold it                                                                         | Ask the Director                              |
| _"A registered matter needs a deadline…"_                      | A matter with no due date is invisible to the delay figures                                        | Give it a review date, or the real deadline   |
| Status will not move beyond _Newly received_                   | Golden Rule 2: no assigned action                                                                  | Record the action first                       |
| _"This matter cannot be referred without a response deadline"_ | Golden Rule 3                                                                                      | Set a deadline with the section               |
| _"An Industrial and General referral must state all four…"_    | §8: the four statements                                                                            | Write all four, or the referral is refused    |
| _"All three are required before the matter can be closed"_     | Golden Rule 4                                                                                      | Outcome, date, and who communicated it        |
| The closure button stays disabled                              | A required closure document is missing from the File                                               | Upload the four required classes              |
| A brief will not save                                          | A matter flagged or at `Awaiting decision` must state what is being decided and the recommendation | Fill in both sections                         |
| _"Show no more than 25 rows at a time"_                        | Page-size bounds                                                                                   | Use the pager                                 |
| _"Choose a month, in the form 2026-01"_                        | Empty or malformed period                                                                          | Clear the picker to use the current month     |
| _"Choose which matter this applies to"_                        | The interface and the database disagree                                                            | Report it — this is a fault, not your mistake |
| _Account appears in the accountability trail_                  | Deleting would break the audit history                                                             | Deactivate instead                            |
| _At least one active platform administrator must remain_       | The platform must stay manageable                                                                  | Promote someone first                         |

### One habit worth forming

When a matter is not behaving as you expect, **check the Activity tab first**.
Most surprises are a change someone made that you did not see happen — and it is
all recorded there, with a name and a time.
