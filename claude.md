# CLAUDE.md — TailorTrack API Generation Guide

## Project Overview

**TailorTrack** is a digital order tracking and reminder system for local tailoring shops.
- **Tailor (Admin):** Creates orders, updates status, tracks payments, sends WhatsApp reminders.
- **Customer:** Checks order status via a unique public link (no login needed).

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL via Supabase
- **ORM:** Prisma
- **Auth:** Supabase Auth (JWT — tailor only, customers don't log in)
- **Notifications:** Twilio WhatsApp API
- **Hosting:** Vercel

## Database Schema (Prisma)

Use this exact schema when generating endpoints. Do not change field names or types.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  RECEIVED
  CUTTING
  STITCHING
  TRIAL
  READY
  DELIVERED
}

enum PaymentMethod {
  CASH
  UPI
  CARD
}

model Customer {
  id        String   @id @default(uuid())
  name      String
  phone     String   @unique
  address   String?
  notes     String?
  createdAt DateTime @default(now()) @map("created_at")
  orders    Order[]

  @@map("customers")
}

model Order {
  id           String      @id @default(uuid())
  customerId   String      @map("customer_id")
  garmentType  String      @map("garment_type")
  description  String?
  status       OrderStatus @default(RECEIVED)
  totalAmount  Decimal     @map("total_amount") @db.Decimal(10, 2)
  deliveryDate DateTime    @map("delivery_date") @db.Date
  publicToken  String      @unique @default(uuid()) @map("public_token")
  photoUrl     String?     @map("photo_url")
  createdAt    DateTime    @default(now()) @map("created_at")
  updatedAt    DateTime    @updatedAt @map("updated_at")

  customer  Customer   @relation(fields: [customerId], references: [id])
  payments  Payment[]
  reminders Reminder[]

  @@map("orders")
}

model Payment {
  id      String        @id @default(uuid())
  orderId String        @map("order_id")
  amount  Decimal       @db.Decimal(10, 2)
  method  PaymentMethod @default(CASH)
  paidAt  DateTime      @default(now()) @map("paid_at")
  note    String?

  order Order @relation(fields: [orderId], references: [id])

  @@map("payments")
}

model Reminder {
  id          String   @id @default(uuid())
  orderId     String   @map("order_id")
  type        String   // "delivery" | "trial" | "payment"
  scheduledAt DateTime @map("scheduled_at")
  sent        Boolean  @default(false)
  sentAt      DateTime? @map("sent_at")

  order Order @relation(fields: [orderId], references: [id])

  @@map("reminders")
}
```

## Project Structure

Follow this folder structure exactly:

```
tailortrack/
├── prisma/
│   └── schema.prisma          # Schema above
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── orders/
│   │       │   ├── route.ts           # POST (create) + GET (list)
│   │       │   └── [id]/
│   │       │       ├── route.ts       # GET (detail) + PUT (edit)
│   │       │       └── status/
│   │       │           └── route.ts   # PUT (update status)
│   │       └── public/
│   │           └── order/
│   │               └── [token]/
│   │                   └── route.ts   # GET (customer status page)
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── auth.ts            # Auth middleware helper
│   │   ├── whatsapp.ts        # Twilio WhatsApp helper
│   │   └── validation.ts      # Zod schemas for request validation
│   └── types/
│       └── index.ts           # TypeScript types
├── .env                       # Environment variables
├── package.json
└── tsconfig.json
```

## Environment Variables

```env
DATABASE_URL="postgresql://user:password@host:5432/tailortrack"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
TWILIO_ACCOUNT_SID="your-twilio-sid"
TWILIO_AUTH_TOKEN="your-twilio-token"
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
APP_BASE_URL="https://tailortrack.vercel.app"
```

---

## THE 3 API ENDPOINTS TO GENERATE

Generate these 3 endpoints. For each one, create the complete working file with proper error handling, validation, types, and comments.

---

### Endpoint 1: POST /api/orders — Create New Order

**File:** `src/app/api/orders/route.ts`

**Why this is critical:** This is the most-used action. Every time a customer brings clothes, the tailor creates an order here.

**What it must do (step by step):**
1. Authenticate the request — only a logged-in tailor can create orders. Return 401 if not authenticated.
2. Validate the request body using Zod. Required fields:
   - `customerId` (string, UUID) — must reference an existing customer
   - `garmentType` (string) — e.g., "Kurta", "Suit", "Blouse"
   - `totalAmount` (number, positive) — total price
   - `deliveryDate` (string, ISO date, must be in the future)
   - Optional: `description` (string), `photoUrl` (string URL), `advancePayment` (number, positive, less than or equal to totalAmount)
3. Check that the customer exists in the database. Return 404 if not found.
4. Create the order in the `orders` table. Prisma auto-generates `id`, `publicToken`, `createdAt`.
5. If `advancePayment` is provided and > 0, create a payment record in the `payments` table linked to this order with method "CASH" as default.
6. Schedule a delivery reminder in the `reminders` table — set `scheduledAt` to 1 day before `deliveryDate`, type "delivery", sent false.
7. Send a WhatsApp confirmation message to the customer's phone number using Twilio. Message format:
   ```
   Hi {customerName}! Your {garmentType} order has been received by {shopName}.
   Expected delivery: {deliveryDate}.
   Track your order here: {APP_BASE_URL}/status/{publicToken}
   ```
   If WhatsApp sending fails, log the error but do NOT fail the whole request — the order should still be created successfully.
8. Return 201 with the created order (include `publicToken`, customer info, payment if created, and the status link URL).

**Response format:**
```json
{
  "success": true,
  "order": {
    "id": "uuid",
    "customerId": "uuid",
    "customerName": "Amit Kumar",
    "customerPhone": "+919876543210",
    "garmentType": "Kurta",
    "description": "Navy blue, slim fit",
    "status": "RECEIVED",
    "totalAmount": 1500.00,
    "deliveryDate": "2026-10-15",
    "publicToken": "abc123-unique",
    "statusLink": "https://tailortrack.vercel.app/status/abc123-unique",
    "createdAt": "2026-09-21T10:30:00Z",
    "payment": {
      "amount": 500.00,
      "method": "CASH",
      "paidAt": "2026-09-21T10:30:00Z"
    },
    "balanceDue": 1000.00
  }
}
```

**Error responses:**
- 401 `{ "error": "Unauthorized" }` — not logged in
- 400 `{ "error": "Validation failed", "details": [...] }` — bad input
- 404 `{ "error": "Customer not found" }` — invalid customerId

---

### Endpoint 2: PUT /api/orders/[id]/status — Update Order Status

**File:** `src/app/api/orders/[id]/status/route.ts`

**Why this is critical:** This is the backbone of order tracking. The tailor clicks one button to move an order to the next stage.

**What it must do (step by step):**
1. Authenticate — tailor only. Return 401 if not.
2. Extract `id` from URL params.
3. Validate request body: `{ "status": "CUTTING" }`. The status must be a valid `OrderStatus` enum value.
4. Fetch the current order from the database. Return 404 if not found.
5. **Enforce status order** — the tailor can only move forward, not backward. The valid sequence is:
   ```
   RECEIVED → CUTTING → STITCHING → TRIAL → READY → DELIVERED
   ```
   If the new status is not the immediate next step, return 400 with error message explaining the valid next status. Example: if current is CUTTING, only STITCHING is allowed.
6. Update the order status in the database.
7. **Auto-trigger WhatsApp** on these specific status changes:
   - When status becomes `READY`: Send WhatsApp to customer:
     ```
     Hi {customerName}! Great news — your {garmentType} is ready for pickup!
     Balance due: ₹{balanceDue}.
     Details: {APP_BASE_URL}/status/{publicToken}
     ```
   - When status becomes `DELIVERED`: Send WhatsApp:
     ```
     Hi {customerName}! Your {garmentType} has been delivered. Thank you for choosing us!
     ```
   Do NOT send WhatsApp for other status changes (CUTTING, STITCHING, TRIAL) — those are internal stages.
   If WhatsApp fails, log the error but do NOT fail the request.
8. Return 200 with the updated order, including previous status for confirmation.

**Response format:**
```json
{
  "success": true,
  "order": {
    "id": "uuid",
    "garmentType": "Kurta",
    "previousStatus": "STITCHING",
    "currentStatus": "TRIAL",
    "customerName": "Amit Kumar",
    "deliveryDate": "2026-10-15",
    "updatedAt": "2026-09-21T14:00:00Z",
    "whatsappSent": false
  }
}
```

**Error responses:**
- 401 `{ "error": "Unauthorized" }`
- 404 `{ "error": "Order not found" }`
- 400 `{ "error": "Invalid status transition. Current: CUTTING. Next allowed: STITCHING" }`

---

### Endpoint 3: GET /api/public/order/[token] — Customer Order Status (Public)

**File:** `src/app/api/public/order/[token]/route.ts`

**Why this is critical:** This is what the customer sees when they tap the WhatsApp link. It's the whole reason they don't need to call the shop anymore.

**What it must do (step by step):**
1. **NO authentication required** — this is a public endpoint. Anyone with the token can view it.
2. Extract `token` from URL params.
3. Find the order in the database by `publicToken`. Include the customer name (but NOT phone or address — privacy) and all payments for this order.
4. Return 404 with a friendly message if not found.
5. Calculate:
   - `totalPaid`: Sum of all payments for this order
   - `balanceDue`: totalAmount - totalPaid
   - `statusStep`: Which step number out of 6 (RECEIVED=1, CUTTING=2, ... DELIVERED=6)
   - `isOverdue`: Is today past the deliveryDate AND status is not DELIVERED?
6. Return the order status with everything a customer needs — no sensitive data.

**Response format:**
```json
{
  "success": true,
  "order": {
    "garmentType": "Kurta",
    "description": "Navy blue, slim fit",
    "status": "STITCHING",
    "statusStep": 3,
    "totalSteps": 6,
    "statusLabel": "Your order is being stitched",
    "deliveryDate": "2026-10-15",
    "isOverdue": false,
    "daysRemaining": 24,
    "payment": {
      "totalAmount": 1500.00,
      "totalPaid": 500.00,
      "balanceDue": 1000.00
    },
    "shop": {
      "name": "Star Tailors",
      "phone": "+911234567890",
      "address": "MG Road, Shop #12"
    },
    "timeline": [
      { "step": 1, "label": "Order Received", "status": "completed", "icon": "📥" },
      { "step": 2, "label": "Cutting", "status": "completed", "icon": "✂️" },
      { "step": 3, "label": "Stitching", "status": "current", "icon": "🧵" },
      { "step": 4, "label": "Trial Fitting", "status": "upcoming", "icon": "👔" },
      { "step": 5, "label": "Ready", "status": "upcoming", "icon": "✅" },
      { "step": 6, "label": "Delivered", "status": "upcoming", "icon": "📦" }
    ]
  }
}
```

**Error responses:**
- 404 `{ "error": "Order not found. Please check your link or contact the shop." }`

---

## ALSO GENERATE THESE HELPER FILES

### 1. `src/lib/prisma.ts` — Prisma Client Singleton
Standard Next.js Prisma singleton pattern to avoid creating multiple database connections in development.

### 2. `src/lib/whatsapp.ts` — Twilio WhatsApp Helper
A helper function `sendWhatsApp(to: string, message: string): Promise<boolean>` that:
- Sends a WhatsApp message using Twilio SDK
- Returns `true` on success, `false` on failure
- Logs errors but never throws — calling code should not fail if WhatsApp is down
- Formats the phone number to include `whatsapp:` prefix

### 3. `src/lib/validation.ts` — Zod Validation Schemas
Zod schemas for:
- `CreateOrderSchema` — validates the POST /api/orders request body
- `UpdateStatusSchema` — validates the PUT /api/orders/[id]/status request body
Use Zod's `.safeParse()` pattern for clean error messages.

### 4. `src/lib/auth.ts` — Auth Middleware Helper
A function `authenticateTailor(request: Request): Promise<{ userId: string } | null>` that:
- Extracts the JWT token from the Authorization header (Bearer token)
- Verifies it with Supabase Auth
- Returns the user object if valid, null if not
- Used by Endpoint 1 and 2 (NOT Endpoint 3 — that's public)

---

## Code Style Rules

- Use TypeScript strict mode
- Use `try/catch` on every endpoint with proper HTTP error codes
- Use `NextResponse.json()` for all responses
- Add JSDoc comments on every function explaining what it does
- Use descriptive variable names (not `x`, `res`, `data`)
- Log errors with `console.error` with context (which endpoint, what failed)
- Never expose internal error messages to the client — return generic messages
- Format all money values to 2 decimal places
- All dates in ISO 8601 format
- Keep each file under 150 lines — if it's longer, split into helper functions