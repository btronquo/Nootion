# Google Calendar

The **Google Calendar** plugin ships with Nootion. It syncs a database with a Google calendar, **both ways**:

- each row with a date in the chosen column becomes an event (its title is the row's title, its description a link
  back to the row);
- events created, moved, renamed or deleted in Google change the database: a new event adds a row, a deleted one
  sends its row to the trash (from where it can be restored).

Syncs run every minute, and on demand with **Sync now**. When a row and its event both changed since the last
sync, the latest change wins.

## Setting it up (administrator, once)

Google asks each app that reads calendars to have an OAuth client. It's free and takes a few minutes:

1. Open [Google Cloud Console](https://console.cloud.google.com/), create a project (e.g. "Nootion").
2. **APIs & Services › Library**: enable the **Google Calendar API**.
3. **APIs & Services › OAuth consent screen** (or **Google Auth Platform**): type "External", an app name
   ("Nootion"), your email. Under **Audience**, either add the Google accounts that will use it as **test users**,
   or **publish** the app (see below).
4. **APIs & Services › Credentials › Create credentials › OAuth client ID**, type **Web application**, with this
   **authorized redirect URI**:

   ```
   <APP_URL>/api/plugins/google_calendar/oauth/callback
   ```

   for example `https://notes.example.org/api/plugins/google_calendar/oauth/callback`. Google only accepts `https`
   addresses, or `http://localhost`. `APP_URL` must be the address people use to open Nootion.
5. Copy the **client ID** and **client secret** into **Administration › Plugins › Google Calendar**, and turn the
   plugin on.

> **Test users or published app?** While the app is in "Testing", Google stops the connection of each account after
> 7 days, and it has to be connected again. Publishing it ("In production") removes that limit; Google then shows an
> "unverified app" warning when connecting (click **Advanced › Go to Nootion**), which is fine for a family or a
> small team (up to 100 accounts).

## Syncing a database (everyone)

1. In any page, type `/google calendar` (`/google agenda` in French).
2. **Connect to Google**: Google asks which account to use and to allow Nootion to see your calendars and manage
   their events. Each person connects their own account; the access is stored encrypted (with `APP_SECRET`).
3. Choose the **database**, its **date column**, and the **calendar**, then **Sync**.

The block then shows the sync: what it links, how many events, when it last ran and any error. The person who set
it up can stop it; events already in Google stay there. Disconnecting the Google account (link at the bottom of the
setup) revokes Nootion's access and stops that person's syncs.

The sync works with the rights of the person who set it up: they must be able to edit the database.

### Good to know

- **Use a calendar made for it** ("Nootion tasks"…): the first sync imports every event of the calendar into the
  database.
- Dates: a date without time is an all-day event; a date with a time is an event in the calendar's time zone,
  1 hour long when the row has no end date.
- A repeating event is one row, at its first date. Occurrences changed on their own in Google are not synced.
- Only the title and the dates are synced; other columns stay in Nootion.
