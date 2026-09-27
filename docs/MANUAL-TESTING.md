# How to test podium in the browser

Follow these steps and click through the app as each type of user.
You do not need to write any code.

## Step 0: Start the app

Open a terminal in the project folder and run:

```bash
docker compose up --build
```

Wait until the server says it is listening. Then open http://localhost:3000.

To wipe everything and start fresh at any time:

```bash
docker compose down -v
docker compose up --build
```

## Test accounts

The password for every account is `podium-demo-2026`.

| Email | Who they are |
| --- | --- |
| `emeline@podium.dev` | Organizer |
| `rasmus@podium.dev` | Organizer |
| `odalys@verdanto.io` | Judge |
| `wren@tidepool.dev` | Judge |
| `anouk@sievebox.dev` | Participant |

Judge and admin are given per event. A person is a judge only in the events where
an organizer made them one.

Tip: open one normal browser window and one private window. That lets you be two
different people at the same time.

## Demo events

| Name in the URL | State | Use it to test |
| --- | --- | --- |
| `harbor-hack` | Draft | Hidden events, publishing |
| `summit-open` | Published | Browsing, registering |
| `lattice-jam` | Registration open | Teams, invites |
| `kiln-sprint` | Link only | Sharing by link |
| `quiet-room` | Private | Private events |
| `podium-26` | Judging | Judge screen, progress, results |
| `orbit-cup` | Voting | Community voting |
| `ledger-week` | Results published | Winners, results |
| `atlas-archive` | Archived | Read-only events |

An event page is at `http://localhost:3000/events/<name>`.

---

## 1. Visitor (not signed in)

1. Open the home page. Check that it looks right. Switch between light and dark theme.
2. Click **Browse events**. You should see public events only. The draft `harbor-hack` and the private `quiet-room` should not be in the list.
3. Open `summit-open`. Try the search box and the filters.
4. Open the winners page: `/events/ledger-week/winners`. Results should be visible.
5. Open `/events/harbor-hack`. You should get a "not found" page.
6. Open `/events/kiln-sprint`. It should open, because link only events work by URL.
7. Open `/embed/ledger-week`. A small public gallery should show.
8. Try to register or comment. The app should ask you to sign in.

## 2. New user

1. Go to `/auth`. Pick **User** and create an account with a new email.
2. You should be signed in. Open **Profile** and change your name and bio. Save.
3. Open **Settings**. Look at your signed in devices.
4. Sign out. Sign in again. Then try a wrong password and check you see an error.
5. Open `/organizer`. You should not have organizer tools yet.

## 3. Participant

Sign in as `anouk@sievebox.dev`.

1. Open **My events**, then open `lattice-jam` and click **Register**. Fill in the form and submit.
2. Open **Teams**. Create a team and copy its invite link.
3. In the private window, sign in as your new user and open the invite link. Accept it. The team should now have two members.
4. Try the team board: ask to join a team, then accept or decline the request from the other side. Try leaving a team.
5. Open **Submit**. Fill in the project details: name, tagline, description, links, tags, track. Save it as a draft, edit it, then submit it.
6. Withdraw the submission, then submit it again.
7. Open **Updates** and **Rounds** to read announcements and the schedule.
8. Try to edit a submission after its deadline (for example in `podium-26`). The app should refuse.
9. Try to open these pages for `podium-26`: `/judge`, `/manage`, `/settings`, `/assign`, `/roles`. You should be blocked from all of them.

## 4. Judge

Sign in as `odalys@verdanto.io`.

1. Open `podium-26`, then **Judge**.
2. You should see only the projects assigned to you, with the scoring criteria and how much each one counts.
3. Open a project. Give each criterion a score from 1 to 5. The total should update. Save a draft, then submit.
4. Skip one project, then come back to it.
5. Open an event where this account is not a judge. The judge screen should be blocked.
6. In an event that uses ranking instead of scores, put the projects in order and submit.
7. Open the **Certificate** page. Copy the signed record, open `/verify`, and paste it. It should say it is genuine. Change one letter and it should fail.
8. Check that you cannot see other judges' scores or the organizer pages.

## 5. Organizer

Sign in as `emeline@podium.dev`.

### Create an event

1. Go to `/events/new`. Fill in the steps: basics, dates, tracks, prizes, questions.
2. Click **Save as draft**. The event should be hidden from the public.
3. Reopen it and click **Publish event**. It should now show in the public list.

### Event settings

Open the event, then **Settings**.

1. **Event status:** change the state.
2. **Visibility and sharing:** try Public, Link only and Private. Copy the share link and check each one from the private window.
3. **Voting:** one vote per person is the default. Switch to quadratic and set how many credits each person gets. The credits are required.
4. **Rubric:** add criteria and weights. The weights must add up to 100 or the app should refuse.
5. **Webhooks:** add a URL subscribed to **all events**, do anything in the event (add a FAQ item, post an update), and check the delivery log.
6. **Bulk import:** upload a CSV with `email,name,team` columns, including one address that has no account and two rows on the same team. The people should appear under **Roles**, the new account should exist, and the team should appear under **Teams**. A row for a full team is reported, not placed.
7. **Exports:** download the CSV and JSON files.
8. Add a round, a FAQ item and an announcement. Check that participants can see them.

### Roles

1. Open **Roles**. Make someone a judge, and limit them to one track. Make someone else an admin.
2. Remove a role. That person should lose access.

### Judging

1. Open **Assign**. Assign judges by hand, then try the automatic option.
2. Open **Manage** to see progress: who has started, who has not, and how many reviews each project has.
3. Run normalization. Look at the raw scores, the adjusted scores and the final ranking.
4. Publish the results. Then check the winners page while signed out.

### Voting

1. Open **Voting** for `orbit-cup`. Choose who can vote: anyone with the link, email only, or signed in users.
2. In the private window, open **Vote** and cast votes. You should not be able to vote for your own project. Different voters should see projects in a different order. Totals should stay hidden.
3. As organizer, look at the ballots, then close the voting. Totals should now show.
4. Try to change the voting type after voting has started. The app should refuse.
5. Delete a comment from the gallery as a moderator.

### Audit log

Open the audit log. It should list sign ins, role changes, submissions, scores and refused late edits.

## 6. Admin

An admin is someone an organizer trusted with one event.

1. As organizer, make `wren@tidepool.dev` an admin of an event.
2. Sign in as `wren@tidepool.dev`. In that event, open **Manage**, **Roles** and **Settings**. They should all work.
3. Open an event where `wren@tidepool.dev` is only a judge. Manage and Settings should be blocked.
4. Open `/events/<name>/settings` as someone who is not an admin. You should see a "no access" message instead of the form.

## 7. Other checks

- Look at the home page, sign in page, an event page, the judge screen and settings in both light and dark theme.
- Make the browser window narrow, like a phone (about 390px wide). Nothing should scroll sideways.
- Sign out on one device. Remove a device in **Settings**. That device should be signed out.
- Turn off your internet after the first build. The app and its fonts should still load.

## Start over

```bash
docker compose down -v
docker compose up --build
```

This deletes everything you created and loads the demo data again.
