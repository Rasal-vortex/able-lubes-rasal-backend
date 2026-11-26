export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Able Lubes Inventory & Billing API",
    version: "1.0.0",
    description:
      "REST API for a single-shop lubricant inventory and billing backend. List endpoints for products, brands, units, customers, and suppliers default to active=true; pass active=false to list inactive records.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  paths: {
    "/dashboard/summary": {
      get: {
        summary: "CRM Overview dashboard summary",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "month",
            in: "query",
            required: false,
            schema: {
              type: "string",
              pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
              example: "2026-11",
            },
            description:
              "Month to return daily paid and credit sales for, in YYYY-MM format",
          },
        ],
        responses: {
          "200": {
            description:
              "Today totals, outstanding balances, monthly count, chart data and latest sales",
          },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Sign in",
        responses: {
          "200": { description: "JWT and user profile" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        summary:
          "Issue a fresh access token from the HttpOnly refresh-session cookie",
        responses: {
          "200": { description: "Refreshed access token and user profile" },
          "401": {
            description: "Refresh session is missing, expired, or revoked",
          },
        },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Revoke the current refresh session and clear its cookie",
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/auth/users": {
      post: {
        summary: "Create a user (admin only)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created user profile" } },
      },
    },
    "/products": {
      get: {
        summary: "List products",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated product list" } },
      },
      post: {
        summary: "Create product",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created product" } },
      },
    },
    "/brands": {
      get: {
        summary: "List brands",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated brands" } },
      },
      post: {
        summary: "Create brand",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created brand" } },
      },
    },
    "/brands/{id}": {
      get: {
        summary: "Get brand",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Brand" } },
      },
      patch: {
        summary: "Update or deactivate brand",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated brand" } },
      },
    },
    "/units": {
      get: {
        summary: "List units",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated units" } },
      },
      post: {
        summary: "Create unit",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created unit" } },
      },
    },
    "/units/{id}": {
      get: {
        summary: "Get unit",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Unit" } },
      },
      patch: {
        summary: "Update unit name, symbol, or decimal allowance",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated unit" } },
      },
    },
    "/stock-adjustments": {
      get: {
        summary: "List stock movement history",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Paginated movements; optionally filter by productId",
          },
        },
      },
      post: {
        summary: "Adjust product stock by inventory batch (admin only)",
        description:
          "IN adjustments require positive purchaseRate and sellingRate and create a new adjustment batch. OUT adjustments require inventoryBatchId and reduce only that batch. The reason remains optional.",
        security: [{ bearerAuth: [] }],
        responses: {
          "201": { description: "Stock movement and resulting stock" },
          "409": { description: "Insufficient or concurrently changed stock" },
        },
      },
    },
    "/coupons": {
      get: {
        summary: "List coupons by type",
        description:
          "Use type=all, type=sales-based, or type=non-sale-based. Defaults to all.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated coupons" } },
      },
      post: {
        summary: "Create a standalone coupon record",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created coupon" } },
      },
    },
    "/coupons/redemptions": {
      get: {
        summary: "List recorded coupon payments with their bills and customers",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Coupon redemption history" } },
      },
    },
    "/coupons/{id}": {
      get: {
        summary: "Get coupon",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Coupon" } },
      },
      patch: {
        summary: "Update standalone coupon",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated coupon" } },
      },
      delete: {
        summary: "Delete standalone coupon",
        security: [{ bearerAuth: [] }],
        responses: { "204": { description: "Deleted coupon" } },
      },
    },
    "/products/{id}": {
      get: {
        summary: "Get product",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Product" } },
      },
      patch: {
        summary: "Update product",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated product" } },
      },
    },
    "/customers": {
      get: {
        summary: "List customers",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated customers" } },
      },
      post: {
        summary: "Create customer",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created customer" } },
      },
    },
    "/suppliers": {
      get: {
        summary: "List suppliers",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated suppliers" } },
      },
      post: {
        summary: "Create supplier",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created supplier" } },
      },
    },
    "/sales": {
      post: {
        summary: "Post a sale, discount, payment allocations, and stock deduction atomically",
        description: "The server calculates the final invoice amount from sold item rates, quantity, manual discountAmount, and couponPrice. paymentAllocations and idempotencyKey are required; allocations must reconcile exactly to the calculated total. CREDIT is the unpaid customer balance, not a received-payment record. Payment rows and Store Credit debits are committed with the sale and stock updates. Retries with the same idempotencyKey return the original invoice without recording tenders twice. Provide creditBill metadata when a CREDIT allocation is present.",
        security: [{ bearerAuth: [] }],
        responses: {
          "201": { description: "Posted invoice" },
          "409": { description: "Insufficient stock or conflicting request" },
        },
      },
    },
    "/sales/{id}": {
      patch: {
        summary: "Add or replace coupon on an unpaid sale",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Updated sale and coupon" },
          "409": { description: "Sale has payments or coupon code is taken" },
        },
      },
    },
    "/purchases": {
      post: {
        summary:
          "Post purchase, create one priced stock batch per item, and add inventory",
        description:
          "Each item requires a positive supplierRate and sellingRate. idempotencyKey makes retries return the original purchase instead of creating duplicate stock batches.",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Posted purchase" } },
      },
    },
    "/sales/{id}/cancel": {
      post: {
        summary: "Cancel a sale, preserve receipts, restore original batches, and track refunds",
        description: "Requires a cancellation reason and explicit refundMode. Refund entries represent actual money returned now; any remaining collected amount is stored as a pending refund payable. Original sale and payment records are preserved.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled sale with cancellation and refund audit" }, "409": { description: "Sale is not posted or stock cannot be safely restored" } },
      },
    },
    "/purchases/{id}/cancel": {
      post: {
        summary: "Cancel a purchase and reverse stock with supplier credit or refund tracking",
        description: "Requires a cancellation reason. Original supplier payments remain in history and their allocations are reversed. General supplier payments not actually refunded or explicitly marked as pending are transferred to supplier credit and applied FIFO to other outstanding purchases; unused credit remains available for future purchases. Only explicitly recorded actual or pending refunds create supplier refund records. Cancellation is all-or-nothing and is blocked when any original batch has sale, return, adjustment, or other stock movement history.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled purchase with cancellation and refund status" }, "409": { description: "Purchase is already cancelled or stock history prevents safe cancellation" } },
      },
    },
    "/purchases/{id}/refunds/settlements": {
      post: {
        summary: "Settle part or all of a pending supplier refund",
        description: "Records actual funds received, linked to the original supplier payment allocation. Pending amounts do not affect cash or bank balances until a settlement is recorded. Idempotency prevents duplicate settlement submissions.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Supplier refund settlement recorded" }, "409": { description: "Refund was already fully settled or purchase is not cancelled" } },
      },
    },
    "/customer-payments": {
      post: {
        summary:
          "Record a Cash, UPI, or coupon-amount payment against one invoice; coupon codes are optional",
        description:
          "A coupon payment can be recorded by amount alone. If a coupon code is provided, it must be unrecorded and unused. Code-less coupon payments are stored as Coupon payment (no code) and are not coupon-code redemptions.",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Recorded payment" } },
      },
    },
    "/supplier-payments": {
      post: {
        summary:
          "Record a supplier payment and allocate it to the oldest outstanding purchases first",
        description:
          "For compatibility, provide either amount and method (CASH or UPI), or a tenders array containing Cash and/or UPI amounts. receiptNumber is optional and is stored with the payment for ledger tracing. purchaseId identifies a purchase for the selected supplier; the combined payment may exceed that invoice balance but must not exceed the supplier's total outstanding. Each tender is allocated oldest-first across that supplier's posted purchases and stored as a separate payment method entry.",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Recorded payment" } },
      },
    },
    "/credit-bills": {
      get: {
        summary:
          "List persisted manual and Billing-generated customer credit bills, including cancelled sale and refund history",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Customer credit bills with payment history and outstanding balances",
          },
        },
      },
      post: {
        summary: "Create a manual customer credit bill",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created customer credit bill" } },
      },
    },
    "/credit-bills/{id}": {
      delete: {
        summary: "Delete an unpaid manual customer credit bill",
        description: "Sales-linked credit bills and bills with payment history cannot be deleted.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Deleted customer credit bill" },
          "404": { description: "Credit bill not found" },
          "409": { description: "Bill is linked to a sale or has payment history" },
        },
      },
    },
    "/credit-bills/{id}/payments": {
      post: {
        summary:
          "Record a Cash or UPI payment against a manual customer credit bill",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated credit bill balance" } },
      },
    },
    "/credit-bills/{id}/cancel": {
      post: {
        summary: "Safely cancel a Billing-generated sale and its linked credit bill",
        description: "Requires a reason, an explicit staff confirmation of the actual amount received, and refundMode. Recorded receipts are never treated as proof of payment. When actual received is zero, no refund or payable is created. When money was received, refunds record amounts actually paid back now and any remainder stays as a pending refund payable. Keeps original sale, bill, and payment history; reverses inaccurate receipts with linked corrections; restores exact inventory batches and records stock movements in the same transaction.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled credit sale and audit details" }, "409": { description: "Bill is not linked to a safely cancellable posted sale" } },
      },
    },
    "/credit-bills/{id}/refunds": {
      post: {
        summary: "Settle part or all of a pending refund payable",
        description: "Records a separate refund outflow with method, optional reference, and required UUID idempotencyKey. Settlement cannot exceed the current pending balance; duplicate submissions with the same key do not create another refund.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated refund payable and refund history" }, "409": { description: "No pending refund or concurrent balance change" } },
      },
    },
    "/expenses": {
      get: {
        summary: "List expenses",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated expenses" } },
      },
      post: {
        summary: "Record expense (description optional)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created expense" } },
      },
    },
    "/export/database": {
      get: {
        summary: "Get an admin-only database export download link",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Download URL and export filename" },
          "403": { description: "Admin role required" },
        },
      },
    },
    "/export/database/download": {
      get: {
        summary: "Download the Excel database export (admin only)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Excel workbook download" },
          "403": { description: "Admin role required" },
        },
      },
    },
    "/reports/sales": {
      get: {
        summary: "Sales report by date range",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Date-range sales totals and invoices with item lines, historical units, and payment rows",
          },
        },
      },
    },
    "/reports/purchases": {
      get: {
        summary: "Purchase report by date range",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Purchases" } },
      },
    },
    "/reports/expenses": {
      get: {
        summary: "Expense report by date range",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Expenses" } },
      },
    },
    "/reports/suppliers/outstanding": {
      get: {
        summary: "Supplier outstanding balances",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Outstanding balances from purchases and payments",
          },
        },
      },
    },
    "/reports/suppliers/{id}/ledger": {
      get: {
        summary:
          "Get an individual supplier ledger with aggregate outstanding balance",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description:
              "Supplier, total billed, total paid, total outstanding, and purchase/payment history",
          },
        },
      },
    },
    "/reports/daily-sales": {
      get: {
        summary:
          "Received customer payments for a business date, with invoice product lines",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "date",
            in: "query",
            required: true,
            schema: { type: "string", format: "date" },
          },
        ],
        responses: {
          "200": {
            description:
              "Active payments received on the requested date, plus separate actual refund outflows; pending refund payables are not reported as outflows",
          },
        },
      },
    },
    "/reports/profit": {
      get: {
        summary: "Profit less expenses for a date range",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "from",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
          },
          {
            name: "to",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: {
          "200": {
            description:
              "Item profit using sale-time purchase costs, total expenses, and final profit",
          },
        },
      },
    },
    "/reports/monthly": {
      get: {
        summary: "Monthly sales, purchase and expense totals; excludes profit",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Monthly summary" } },
      },
    },
  },
};
