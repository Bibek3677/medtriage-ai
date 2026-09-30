# MedTriage AI

**ITC 6250 — Interactive System Design & Web Development · Group 5**
Nguyen Dang Thanh Nguyen (Back-end / Data Integrator) · Yara Ghaith (Project Manager) · Bibek Panta (Front-end Developer)
Instructor: Prof. Setrag Khoshafian

A working prototype of a low-code/no-code care-coordination agent. It automates the
patient journey end to end: **intake → triage against protocol → routing to the right
provider → post-visit follow-up.**

> **Educational prototype. Not a medical device.** The rule set is deliberately
> simplified and is not medical knowledge. Don't enter real patient information.

---

## Running it

Needs Node 20 or newer. Nothing to install — there are no dependencies.

```bash
cd "group project"
npm start              # serves at http://localhost:8080
npm test               # runs the protocol test suite (36 tests)
```

`npm start` just runs `node serve.js`; pass a port if 8080 is taken
(`node serve.js 8081`). Opening `index.html` straight from disk also works.

Saved cases live in the browser's `localStorage` under `medtriage-queue-v2` —
nothing leaves the machine. **Clear queue** wipes them; **Export JSON** hands the
queue off as a data file.

---

## The four stages

| Stage | Where | What happens |
| --- | --- | --- |
| **Intake** | Steps 1–3 | Demographics, symptoms, severity, duration, vitals, history. Vitals are optional; every field is range-checked before the step advances. |
| **Triage** | Step 4 | All 35 rules are evaluated. The most urgent rule that fires sets the category; every rule that fired is listed as a reason with its ID. Ambiguity is flagged, and a reviewer can override the category with initials and a reason. |
| **Routing** | Step 5 | The case is matched to destinations that accept its category, ranked by specialty fit, and a real appointment time is booked inside the category's target window. Emergencies are handed off immediately instead of scheduled. |
| **Follow-up** | Step 6 | Reminders are generated *relative to the booked visit* — pre-visit reminder, day-of confirmation, post-visit check-in — then the case is saved to the care queue, sorted by priority. |

The **Protocol** tab renders the complete rule set and provider directory straight
from `rules.js`, so what's documented can't drift from what runs.

---

## Architecture

```
index.html   markup and the six intake steps
styles.css   design tokens, light/dark themes, layout
rules.js     the clinical protocol — no DOM access, unit-tested
app.js       UI layer: steps, validation, rendering, the care queue
serve.js     dependency-free static server
tests/       node:test suite over rules.js
```

The split matters: **`rules.js` holds every clinical decision and touches no DOM.**
That is what makes the protocol testable in isolation, renderable as a reference
table, and reviewable by someone who doesn't read front-end code.

### Triage categories

| Category | Target | Routes to |
| --- | --- | --- |
| Emergency | Immediate handoff | Emergency Department (walk-in / EMS) |
| Urgent | 1–4 hours | Urgent care, or a matching specialty clinic |
| Soon | 24–72 hours | Primary care, telehealth, or a specialty clinic |
| Self-care | 1–7 days | Nurse advice line, telehealth, primary care, or no appointment |

### How routing picks a provider

1. Keep destinations whose `accepts` list includes the triage category.
2. Drop specialty clinics the patient doesn't match. Specialty signals are derived
   from the case — age under 18 → Pediatrics, pregnancy → Obstetrics, chest pain or
   cardiac history → Cardiology, breathlessness or asthma/COPD → Pulmonology,
   diabetes with related symptoms → Endocrinology.
3. Offer only times inside the category's target window **and** inside that
   provider's clinic hours.
4. Rank specialty matches first, then by earliest availability.
5. If nothing is open inside the window — an overnight intake, say — widen the
   search to two weeks and label the result **outside the booking target**, so a
   case never silently ends up with nowhere to go.

---

## Testing

```bash
npm test
```

36 tests over `rules.js`, covering rule-boundary exclusivity, routing, and
reminder scheduling. Several exist to pin down bugs that are easy to reintroduce:

- **Blank vitals must not satisfy a "less than" threshold.** In JavaScript
  `null < 95` is `true`, so an empty temperature field would otherwise fire the
  hypothermia rule. Unknown numbers are normalized to `NaN`, which fails every
  comparison.
- **A missing age must not be read as an infant.** Same coercion trap: `null < 0.25`.
- **Rules that share a symptom must be mutually exclusive.** R04/R05 (chest pain)
  and every vitals band are asserted never to fire together, so a case can't
  report two contradictory reasons.
- **Reminders must never be scheduled in the past.** An appointment 90 minutes out
  leaves no room for a 24-hour-before reminder; it's dropped rather than backdated.

---

## Known limitation: the pediatric edge case

**The vitals thresholds are adult values.** This is the demo's override story, and
it is worth walking through in the presentation.

Load the **Toddler with high fever** sample. A 2-year-old with a heart rate of 140
triggers `R19` (*heart rate above 130 bpm*) and the case is categorised
**Emergency** — but 140 bpm is a normal pulse for a two-year-old. The protocol has
no pediatric heart-rate band, so it applies the adult one.

What the system does about it, rather than guessing:

- It **names the rule that escalated the case** (`R19`, with the measured value),
  so the reviewer can see exactly what drove the result.
- It **flags the case as pediatric** — "the vitals thresholds in this rule set are
  adult values" — and flags that signals point to several different categories.
- It **requires a human to resolve it**: the reviewer overrides down to Urgent with
  their initials and a reason, and the override is stored on the case alongside the
  original assessment (`Emergency → Urgent`), so the queue keeps both.

This is the intended answer to *"what happens when the rule is ambiguous?"* — the
protocol escalates and explains rather than quietly deciding, and the override is
recorded as data rather than lost. `tests/rules.test.js` pins the behaviour so the
team is alerted if the rule set changes.

Other limitations worth naming in Q&A:

- **Free-text notes are never analysed.** A note reading "coughing up blood" does
  not change the category. The system flags that unread notes exist on lower-priority
  cases instead of pretending to understand them.
- **Availability is synthetic.** Slots are generated from clinic hours, not from a
  real scheduling system, and nothing is double-booked against another case.
- **No persistence beyond the browser.** The queue is `localStorage`; JSON export
  is the handoff path.

---

## Accessibility

Built to be usable without a mouse or a high-resolution eye:

- Atkinson Hyperlegible, 17px base, 1.5 line height.
- Full keyboard operation: a visible 3px focus ring, arrow-key navigation across the
  view tabs with roving `tabindex`, and focus moved to the step heading on advance.
- Every input has a real `<label>`; validation errors are text next to the field,
  never colour alone. Triage categories pair colour with a name and a position
  indicator.
- Light and dark themes both meet contrast targets; the toggle honours the system
  setting until overridden. `prefers-reduced-motion` suppresses the result animation.
- All rendered user input is HTML-escaped.
