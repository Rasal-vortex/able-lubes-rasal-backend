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
    "/auth/login": {
      post: {
        summary: "Sign in",
        responses: {
          "200": { description: "JWT and user profile" },
          "401": { description: "Invalid credentials" },
        },
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
        summary: "Update or deactivate unit",
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
        summary: "Adjust product stock (admin only)",
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
        summary: "Post sale, optionally apply coupon, and deduct inventory",
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
        summary: "Post purchase and add inventory",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Posted purchase" } },
      },
    },
    "/sales/{id}/cancel": {
      post: {
        summary: "Cancel an unpaid sale and restore stock once",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled sale" } },
      },
    },
    "/purchases/{id}/cancel": {
      post: {
        summary: "Cancel an unpaid purchase and reverse stock",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Cancelled purchase" } },
      },
    },
    "/customer-payments": {
      post: {
        summary: "Record payment against one customer invoice",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Recorded payment" } },
      },
    },
    "/supplier-payments": {
      post: {
        summary: "Record supplier payment against one purchase",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Recorded payment" } },
      },
    },
    "/expenses": {
      get: {
        summary: "List expenses",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Paginated expenses" } },
      },
      post: {
        summary: "Record expense",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created expense" } },
      },
    },
    "/reports/sales": {
      get: {
        summary: "Sales report by date range",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Daily sales totals" } },
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
    "/reports/customers/outstanding": {
      get: {
        summary: "Customer outstanding balances",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Outstanding balances from invoices and payments",
          },
        },
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
    "/reports/monthly": {
      get: {
        summary: "Monthly sales, purchase and expense totals; excludes profit",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Monthly summary" } },
      },
    },
  },
};
