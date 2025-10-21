# Internal ORD SQL Query Tool

An AI-assisted internal SQL exploration tool designed for **non-technical business and operations teams** to query live ORD data with natural language.

---

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

---

## ✅ Status

🔄 Phase: **Internal Testing**  → Target Users: **Sales Ops / Business Analysts**

---

## 📄 License

Internal Proprietary — Do **Not** Distribute Outside Organization.
