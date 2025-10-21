# Internal Org SQL Query Tool

An AI-driven internal SQL query assistant purpose-built for Non-Tech businesses, sales operations, and analytics teams to securely access and explore live ORD data using natural language prompts.

## 🚀 Tech Stack

* **Cohere AI** → LLM for natural language to SQL
* **Turso** → serverless SQLite database
* **Drizzle ORM** → type-safe DB schema + migrations
* **Next.js (App Router)** → full-stack frontend + backend

---

## 📦 Database Overview

Currently supports two live business tables:

| Table     | Description                             |
| --------- | --------------------------------------- |
| `Sales`   | Stores order & revenue transaction data |
| `Product` | Stores all available product metadata   |

---

## 💡 Key Features

* 🔍 Ask questions in **plain English** → auto-converts to **SQL**
* ✅ SQL **auto-validated** before execution
* 📊 Returns clean, formatted real data instantly
* 🧑‍💼 Designed **specifically for non-engineers**

---

## 🛠️ Local Development

```bash
git clone <repo-url>
cd internal-ord-sql
npm install
npm run dev
```

---

## 🔧 Environment Variables (`.env.local`)

```bash
COHERE_API_KEY=your-key
TURSO_DATABASE_URL=...
DRIZZLE_DB_AUTH_TOKEN=...
```

---

## 🧠 How It Works (Flow)

**User Input → Cohere AI → SQL → Turso DB → Response Table UI**

---

## 📌 Example User Query

> "Show me total revenue per product for last month"

AI generates:

```sql
SELECT product_id, SUM(amount) AS total_revenue 
FROM Sales 
WHERE sale_date >= DATE('now','-1 month') 
GROUP BY product_id;
```

