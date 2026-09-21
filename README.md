# TailorTrack

Order tracking for a tailoring shop. One HTML page, three API endpoints, a Supabase
database, deployed on Vercel. No build step and no framework.

The tailor creates an order and moves it through six stages. The customer opens a link
and watches it progress — no login, no phone call to the shop.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole front end. Shows the tailor's dashboard, or the customer's tracking page when the URL has `?token=...` |
| `api/orders.js` | `GET` lists orders, `POST` creates one |
| `api/order-status.js` | `PUT` moves an order to the next stage |
| `api/track.js` | `GET` the customer's public view of one order |
| `lib/tailortrack.js` | Shared bits: the Supabase connection, the stage list, small helpers |
| `schema.sql` | The database tables. Paste into Supabase once |

Vercel turns every file in `/api` into an endpoint automatically — `api/orders.js`
becomes `/api/orders`. That is the whole routing setup.

## The three endpoints

**`POST /api/orders`** — creates the order. Saves the customer (reusing them if the
phone number is already known), records an advance payment if one was taken, and stores
a delivery reminder dated one day before delivery. Returns the order with its tracking
token.

**`PUT /api/order-status?id=ORDER_ID`** with body `{"status":"CUTTING"}` — moves one
stage forward. The stages are `RECEIVED → CUTTING → STITCHING → TRIAL → READY →
DELIVERED` and only the immediate next one is accepted, so nothing can skip the trial
fitting or reopen a delivered order.

**`GET /api/track?token=PUBLIC_TOKEN`** — the customer's view. No passcode: the random
token in their link is what proves the order is theirs. The customer's phone number and
address are never read from the database in this endpoint, so they cannot leak into the
response.

## Setting it up

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste all of `schema.sql`, and press Run.
3. Open **Project Settings → API** and copy two values: the **Project URL** and the
   **`service_role`** key.

Edit the last part of `schema.sql` first if you want your own shop name and address —
or change the `shop` row later in the Table Editor.

### 2. Vercel

1. Push this folder to GitHub.
2. At [vercel.com](https://vercel.com), **Add New → Project**, and import the repo.
   Framework preset: **Other**. No build command.
3. Add these Environment Variables before deploying:

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your `service_role` key |
| `TAILOR_PASSCODE` | any password you choose |

4. Deploy. Open the URL — you get the tailor's dashboard.

The `service_role` key bypasses the database's security rules, which is why it is a
Vercel environment variable and never appears in `index.html`. Do not put it in the
front end.

`TAILOR_PASSCODE` is what stops a stranger creating orders on your deployment. Type it
into the box at the bottom of the dashboard once per browser tab. If you leave the
variable unset the dashboard works with no password at all, which is fine while you are
testing and not fine once you share the link.

## Trying it

On the dashboard: fill in the new-order form and submit. The order appears in the list
with a stage badge and a **Move to CUTTING** button. Each press advances one stage.

**Copy link** gives you the customer's tracking URL. Open it in another tab to see the
customer's side. **Send on WhatsApp** opens WhatsApp with the message and link already
written, addressed to that customer's number.

Things worth trying deliberately, because they show the rules working:

- Press **Move to** twice quickly — the second press is refused rather than skipping a
  stage.
- Take an order all the way to DELIVERED — the button disappears, since there is
  nowhere further to go.
- Open a tracking link and change one character of the token — you get
  *Order not found*, not somebody else's order.
- Set a delivery date in the past — the form refuses it.

## Running it on your own computer

You need the Vercel CLI, because the `/api` files are serverless functions and opening
`index.html` directly cannot run them.

```bash
npm install
```

```bash
npm install -g vercel
```

Put your Supabase values in a `.env` file (copy `.env.example`), then:

```bash
vercel dev
```

That serves the page and the endpoints together at `http://localhost:3000`.

## What is not built

- **No WhatsApp automation.** The reminder rows are written to the database but nothing
  sends them; the WhatsApp button is you pressing send. Automatic messages would need a
  Twilio account and a scheduled job.
- **No login for the tailor**, just the shared passcode. Real accounts would mean
  Supabase Auth.
- **No editing or deleting orders**, and no search. Stages only move forward.
