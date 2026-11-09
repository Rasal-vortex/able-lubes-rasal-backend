# Able Lubes Inventory & Billing API

TypeScript, Express 5, PostgreSQL, Prisma ORM 7 and Zod backend for one lubricant shop. The API is organized as a feature-based monolith: each business feature owns its routes, controller, service, model, request schema and serializer. REST endpoints are under `/api/v1`; interactive OpenAPI docs are available at `/docs`.

## Requirements

- Node.js 22 or later
- PostgreSQL 15 or later
- npm

## Setup

```powershell
Copy-Item .env.example .env
# Edit .env and set DATABASE_URL, a long JWT_SECRET, and ADMIN_PASSWORD
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

The Prisma 7 generator writes its client into `generated/prisma`. Prisma CLI datasource configuration is in `prisma.config.ts`; runtime PostgreSQL queries use `@prisma/adapter-pg`. Do not edit generated client files or commit `.env`.

On a database with existing units, run `npm run db:unit-mapping` before migrating or seeding. It writes a read-only inventory of units, products, and linked sales, purchases, and stock movements to `output/unit-mapping-report.json`. The seed stops before unit writes if normalized names collide or an existing unit name may be a canonical symbol alias; review the report and resolve the mapping first.

For production, run `npm run build`, then `npm run db:deploy`, then `npm start`. Set production secrets through the deployment environment.

## Environment

See `.env.example`. `ADMIN_PASSWORD` is required only when seeding the initial administrator. The seed hashes the password and upserts one admin account. Do not use example credentials outside local development.

## API overview

All routes other than health and login require `Authorization: Bearer <token>`.

| Method           | Endpoint                                    | Purpose                                                       |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------- |
| POST             | `/api/v1/auth/login`                        | Get a JWT                                                     |
| GET              | `/api/v1/dashboard/summary?month=YYYY-MM`   | CRM Overview totals, balances, daily paid/credit sales, and latest invoices |
| POST             | `/api/v1/auth/users`                        | Admin-only staff/admin account creation                       |
| GET, POST        | `/api/v1/products`                          | Search/list and create products                               |
| GET, PATCH       | `/api/v1/products/:id`                      | Read/update product details including compatible unit changes; stock is never directly writable |
| GET, POST, PATCH | `/api/v1/brands`                            | Manage product brands                                         |
| GET, POST, PATCH | `/api/v1/units`                             | List and manage selectable product units; unit records cannot be deleted or disabled |
| GET, PATCH       | `/api/v1/units/:id`                         | Read or update a unit                                         |
| GET, POST        | `/api/v1/stock-adjustments`                 | View stock movement history and create admin-only adjustments |
| GET, POST, PATCH, DELETE | `/api/v1/coupons`                    | Manage coupons; filter by `type=all`, `sales-based`, or `non-sale-based` |
| GET, POST, PATCH | `/api/v1/customers`                         | Manage customers                                              |
| GET, POST, PATCH | `/api/v1/suppliers`                         | Manage suppliers                                              |
| POST             | `/api/v1/purchases`                         | Post purchase and increase stock atomically                   |
| POST             | `/api/v1/sales`                             | Post sale and decrease stock atomically                       |
| PATCH            | `/api/v1/sales/:id`                         | Apply or replace coupon on an unpaid posted sale              |
| POST             | `/api/v1/customer-payments`                 | Record a Cash/UPI/Coupon payment; call once per tender mode for split payments |
| POST             | `/api/v1/supplier-payments`                 | Record a supplier payment against one purchase                |
| POST             | `/api/v1/sales/:id/cancel`                  | Admin-only cancellation and stock restoration                 |
| POST             | `/api/v1/purchases/:id/cancel`              | Admin-only cancellation and stock reversal                    |
| GET, POST, PATCH | `/api/v1/expenses`                          | List, create and update expenses                              |
| GET              | `/api/v1/reports/sales?from=...&to=...`     | Sales totals plus invoice product lines and recorded payments |
| GET              | `/api/v1/reports/daily-sales?date=YYYY-MM-DD` | Payments actually received on a business date, grouped by invoice with product lines and payment methods |
| GET              | `/api/v1/reports/profit?from=...&to=...`    | Item profit, total expenses, and final profit                  |
| GET              | `/api/v1/reports/purchases?from=...&to=...` | Purchase report                                               |
| GET              | `/api/v1/reports/expenses?from=...&to=...`  | Expense report                                                |
| GET              | `/api/v1/reports/suppliers/outstanding`     | Supplier purchase balances                                    |
| GET              | `/api/v1/reports/suppliers/:id/ledger`      | Supplier purchase/payment history and aggregate outstanding balance |
| GET              | `/api/v1/reports/monthly?from=...&to=...`   | Monthly sales, purchases and expenses                         |

Sales and purchase requests do not use an idempotency key. A retried request can create a second invoice and change stock again, so check the transaction result before resending after a timeout. Sale products, prices and totals are calculated by the server. Customer/supplier payments must be linked to one invoice and may not exceed its remaining amount. Cash and UPI are recorded as actual payments; an unpaid invoice is credit. A sale without a customer can still receive a payment linked to its invoice.

List endpoints support `page`, `limit` (maximum 100), and `search`. Lists of products, brands, units, customers, and suppliers default to `active=true`; pass `active=false` to retrieve inactive records. Ledger and report endpoints retain historical records. Dates are ISO 8601. Monetary and quantity values are returned as decimal strings where applicable.

## Business-rule defaults and limits

- Products reference managed Brand and Unit records. New product creation accepts `qty` for opening stock; later stock changes use stock adjustments.
- Existing sale-based coupons remain fixed-amount discounts. Customer payments also accept `method: "COUPON"` as a tender mode; submit one customer-payment request per payment mode against the same sale. Coupon validation/redemption rules remain pending client feedback.
- Tax is omitted until tax treatment/rates are confirmed.
- Purchase `our rate` is omitted until its meaning is defined.
- Sale lines snapshot purchase cost and product unit when posted. Profit reports use sale-time purchase cost (legacy rows with no cost snapshot fall back to the current product purchase rate).
- Customer/supplier advances and overpayments are rejected; payment allocation across invoices is not supported. Customer payments also record credit settlements, so Daily Sales reports payments only on their actual received date.
- Cancellation restores stock only once by changing the posted record's state within the same transaction. A sale/purchase with linked payments cannot be cancelled through this API; payment reversal/refund handling must be defined before paid invoices can be reversed.
- Product stock changes through opening quantity on product creation, posted purchase/sale workflows, and admin stock adjustments. All are recorded transactionally; manual adjustment history is available through `/api/v1/stock-adjustments`.
- Inventory quantities follow the product unit: integer-only units reject fractions; decimal units accept at most three decimal places. Values are rejected before persistence rather than rounded.
- Reports group dates in `Asia/Kolkata`; `from` and `to` are inclusive ISO date/time instants. Supply explicit time offsets when the reporting window is local business time.

These rules are documented defaults, not assumptions about tax or profit accounting. Revise the schema before the first migration if the business confirms different policies.

## Verification

Run `npm test` for focused tests around decimal line/invoice calculations and stock comparison. Run `npm run build` for TypeScript compilation. API/database integration scenarios require a configured PostgreSQL database and should be verified against the local database before deployment.

## Postman smoke tests

Import `postman/Able-Lubes-API.postman_collection.json` into Postman. Set its `adminPassword` collection variable to the same value as `ADMIN_PASSWORD` in `.env`, run `npm run db:seed`, start the API, and run the collection from top to bottom with Collection Runner. It covers every current API route, including GET/POST/PATCH for CRUD-capable resources, invoice/payment flows, cancellation, and reports. It creates dummy customer, supplier, product, purchase, sale, payment, and expense data; it also checks oversell rejection. Product/customer/supplier delete behavior is tested as soft deactivation with `PATCH active=false`. The API does not expose hard DELETE or PUT, nor sale/purchase reads or expense detail. Running the collection more than once creates additional dummy records.
