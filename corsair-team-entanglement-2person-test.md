# CORSAIR — Team Entanglement: The 2-Person Test

**For Mike + Bryce. Two browsers, two real logins, same Atlas workspace. ~15 minutes.**

This is the test that moves Property 4 off 5/10. Six things the platform now notices on its own. Each one is a single move on **A**'s screen and a single look on **B**'s screen. No code. No setup tax. If it passes cleanly, the score moves to a provisional 7. The 9 takes two weeks of real use after that.

> **The rule:** **B never reloads the page.** If B has to refresh to see what A did, that's a fail — write it down and we fix it.

---

## Before you start — 2 minutes

1. **A** opens Atlas in one browser, **B** in another. Both signed in. Same workspace.
2. Both go to the **Team** view (in the More dropdown if it's not on the main bar).
3. Set yourselves up so the test can tell the visibility dials apart:
   - **Departments** — give each of you a department in the picker next to your name. For test #5 below you'll want to be in **different** departments (e.g. A = Sales, B = Operations). The picker is on your own row; admin can set it on either.
   - **Function role** — set A = **CFO** and B = **COO** (or whatever fits — they just need to be different for test #6).
4. Both open **Today**. Leave it open. From here on, B does not reload anything.

---

## The six things — 10 minutes

### 1. Overlap — "you and B both worked X this week"

- **A:** open any organization that B has *not* recently touched. Log a Quick Touch meeting on it (one line is fine).
- **B:** within a few seconds, also log a Quick Touch meeting on the **same** organization.
- **Both:** look at Today.

**Expect:** a Catch saying something like *"You and {teammate} both worked {Org} this week — coordinate?"* on both screens. The teammate is named (within your department) or shown as the department label (across departments).

**Also checks (silently):** that A's name shows correctly on B's team feed (not a string of letters/numbers), and that B's screen updated without reloading. If either of those is wrong, write it down.

---

### 2. Commitment coverage — "B owns it · confirm covered"

- **A:** create a commitment due in **2 days**. Owner = **B's name** (pick from the teammate list, don't type free-text).
- **B:** look at Today.

**Expect:** a Catch about the commitment that says *"{B} owns it · confirm covered"* — framed as coverage, not as a chase. A should see the same line on their Today.

---

### 3. Customer-quiet — "{Org} is quiet · {dept} tracking"

This one tests what's already there — no setup move needed.

- **Both:** look at Today for any Catch like *"{Org} is quiet — {N} days since the team's last touch."* (It only fires for engaged accounts that have actually gone 21+ days dark, so it may or may not be there. Both is fine — what matters is the *behavior* if it is.)
- If one is firing: **A (or whoever is in the owning department)** clicks **Acknowledge** on it and types a one-line reason.
- **B:** look at the same Catch.

**Expect:** before ack, both see the alert. After ack:
- The owning department (and CEO/COO) see the reason A typed.
- Everyone else sees *"{dept} tracking"* and the alert recedes from the top.

If no customer-quiet Catch is firing on either screen, write it down — we look at whether the data should be triggering one.

---

### 4. Effort-vs-value — "heaviest pursuit neglected"

Also a "look for" — no move needed.

- **Both:** look at Today for a Catch like *"The {$Xm} {Org} pursuit has had no team touch in {N} days while {N} of the last {N} touches were on smaller work."*

**Expect:** if the data shape matches the pattern (a high-weight pursuit going untouched while effort went to lighter accounts), the Catch is there. It's a team-level pattern — no individual is named.

If the data clearly *should* be triggering it and isn't (or it's firing on something that doesn't fit), write it down.

---

### 5. Department-scoped names

- **Make sure A and B are in different departments** (set in step 3 of the setup).
- **A:** log a Quick Touch on any organization.
- **B:** look at the team feed (bottom of Today).

**Expect:** the new row shows A's **department** as the actor (e.g. *"Sales advanced {Org}"*), **not** A's name.

Now put A and B in the **same** department.

- **A:** log another Quick Touch.
- **B:** look at the team feed.

**Expect:** this row shows A's **name** as the actor.

---

### 6. Function-role relevance — different roles, different ordering

- Confirm A = CFO and B = COO (from setup).
- **Both:** look at Today, top of the Catches list.

**Expect:** the ordering differs between the two screens. A (CFO) should see money-shaped Catches (concentration risk, weighted-pipeline mismatches, $-impact commitments) pushed higher. B (COO) should see coverage/commitment/quiet-account Catches pushed higher.

Nothing is hidden on either screen — same Catches available; only the order changes.

If both screens look identical, write it down.

---

## Pass / fail

For each of the six, write **PASS** or **FAIL** with a one-line note of what you actually saw. Send the six lines back — that's the whole report.

- **6/6 PASS** → Property 4 moves to **7/10** (provisional). The 9 comes from two weeks of real use on real accounts.
- **Anything FAIL** → we fix that one specifically. The score holds at 5 until the fail is closed.

**The discipline:** the score moves only on what *actually held* on real data with two real logins. No softening. That's the whole point of this test.

— end —
