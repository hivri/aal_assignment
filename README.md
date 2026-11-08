# LeadFlow — AI-Native Lead-to-Project Pipeline

LeadFlow is a role-based CRM and project handoff application. It manages the flow from lead capture and qualification through proposal creation, deal conversion, project assignment and task delivery. It also includes AI-assisted lead qualification and proposal drafting.

## Features

- **Lead pipeline:** create and track leads through `new`, `qualified`, `proposal_sent`, `won` and `lost` stages.
- **AI lead qualification:** request a structured qualification score, decision, reasoning and suggested next action.
- **AI proposal drafting:** generate a structured proposal using the requirements saved on a lead; generated proposals are persisted in PostgreSQL.
- **Contacts:** create contacts and optionally associate them with a lead.
- **Project conversion:** marking a lead as `won` automatically creates a project if one does not already exist for that lead.
- **Task delivery:** create project tasks, assign projects/tasks to delivery users and update task status.
- **Role-based access control:** permissions are enforced in FastAPI dependencies and query filters, not only by frontend navigation.
- **Admin workspace:** user listing and activation/deactivation controls, plus pipeline, project and task summary analytics.

## Roles and access

| Capability | Admin | Sales Rep | Delivery Member |
|---|---:|---:|---:|
| View all leads | Yes | No — own leads only | No |
| Create/manage leads | Yes | Own leads | No |
| AI lead qualification | Yes | Own leads | No |
| Generate/view proposals | Yes | Own leads only | No |
| Manage/view contacts | All contacts | Own contacts | No |
| View projects | All | Projects for own leads | Assigned projects only |
| Create tasks | Yes | For own projects | No |
| Assign projects/tasks | Yes | For own projects | No |
| Update task status | Yes | No | Assigned tasks only |
| Manage users | Yes | No | No |
| Organization analytics | Yes | No | No |

Access is checked by the backend on each protected request. The frontend hides navigation options that are not relevant to a role, but this is not the security boundary.

## Technology

- **Backend:** Python, FastAPI, SQLAlchemy, Pydantic, JWT authentication
- **Database:** PostgreSQL
- **AI provider:** Groq API (model configured with `GROQ_MODEL`)
- **Frontend:** React, Vite

## Project structure

```text
aal/
├── .env.example
├── .gitignore
├── README.md
├── backend/
│   ├── ai_service.py
│   ├── auth.py
│   ├── db.py
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   └── seed.py
└── ui/
    ├── package.json
    └── src/
        ├── App.jsx
        ├── App.css
        └── index.css
```

## Prerequisites

- Python 3.12 or compatible version
- Node.js 22 or compatible current LTS release, with npm
- PostgreSQL
- A Groq API key for the AI endpoints

## Local setup

### 1. Clone the repository

```bash
git clone <your-github-repository-url>
cd aal
```

### 2. Configure environment variables

Create your local environment file from the template:

```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string, a long random JWT secret, Groq API key and seed-user credentials. Do not commit `.env` or share its contents.

### 3. Create the PostgreSQL database

Create a database and database user, then grant the user access. For example, from `psql` as a PostgreSQL administrator:

```sql
CREATE USER leadflow_user WITH PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE leadflow OWNER leadflow_user;
```

Set `DATABASE_URL` in `.env` to match your database credentials, for example:

```text
postgresql://leadflow_user:replace-with-a-strong-password@localhost:5432/leadflow
```

The application creates missing tables at startup through SQLAlchemy metadata. For an existing database created before the Lead requirements field was added, apply this one-time migration if the column is not already present:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS requirements TEXT;
```

### 4. Install and run the backend

Create and activate a virtual environment, then install the backend dependencies. Generate a pinned dependency file from the working environment with `pip freeze` before deploying (see **Deployment preparation**).

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" sqlalchemy psycopg2-binary python-dotenv "pydantic[email]" groq "pwdlib[argon2]" PyJWT
python -m uvicorn main:app --reload
```

The API is available at `http://localhost:8000`. Interactive API documentation is at `http://localhost:8000/docs`.

### 5. Seed initial users

Set the six seed variables in the root `.env` file. From the `backend` directory with the virtual environment activated, run:

```bash
python seed.py
```

The seed script is safe to run more than once: it checks for each email before creating a user. It creates one Admin, one Sales Rep and one Delivery Member when their corresponding environment variables are set.

### 6. Install and run the frontend

In another terminal:

```bash
cd ui
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The current local frontend configuration calls the API at `http://localhost:8000`.

## Main API routes

The interactive OpenAPI specification at `/docs` is the source of truth for request and response schemas. Main routes include:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Register a Sales Rep account |
| `POST` | `/auth/login` | Obtain an access token |
| `GET` | `/auth/me` | Get the authenticated user |
| `POST` / `GET` | `/leads` | Create and list permitted leads |
| `PATCH` | `/leads/{lead_id}/status` | Update a lead stage; `won` creates a project |
| `POST` / `GET` | `/contacts` | Create and list permitted contacts |
| `POST` | `/ai/leads/{lead_id}/qualify` | Generate AI lead qualification |
| `POST` | `/ai/proposals/generate` | Generate and save a proposal from a lead's stored requirements |
| `GET` | `/proposals` | List proposals visible to the caller |
| `GET` | `/projects` | List projects visible to the caller |
| `PATCH` | `/projects/{project_id}/assign` | Assign a project to a delivery member |
| `POST` / `GET` | `/tasks` | Create and list permitted tasks |
| `PATCH` | `/tasks/{task_id}/assign` | Assign a task to a delivery member |
| `PATCH` | `/tasks/{task_id}/status` | Update task status when permitted |
| `GET` | `/users` | Admin-only user listing |
| `PATCH` | `/users/{user_id}/status` | Admin-only user activation/deactivation |

Protected endpoints require `Authorization: Bearer <access_token>`. Role and ownership checks are performed server-side.

## AI configuration and behavior

The backend calls Groq using `GROQ_API_KEY` and `GROQ_MODEL`. The current model default is `openai/gpt-oss-20b`. AI responses are requested in structured JSON and validated against Pydantic schemas before being returned or saved.

- Lead qualification returns a score, decision, reasoning and next action.
- Proposal generation reads the requirements stored on the selected lead and persists the generated proposal.
- Provider/timeout/validation errors are handled by the API rather than treating unvalidated model output as trusted data.

Keep the Groq API key on the backend only. Never put it in a `VITE_` frontend variable.

## Checks

Frontend lint and production build:

```bash
cd ui
npm run lint
npm run build
```

Backend starts with:

```bash
cd backend
source .venv/bin/activate
python -m uvicorn main:app --reload
```

Recommended manual verification before submission:

1. Sign in separately as Admin, Sales Rep and Delivery Member.
2. Confirm Delivery Members cannot access leads, contacts, proposals or user management through direct API requests.
3. Create two Sales Rep accounts and verify each only sees their own leads, contacts, proposals and related projects/tasks.
4. Confirm an Admin can view the organization-wide records and manage user activation.
5. Mark a lead as won and confirm exactly one project is created for it.
6. Assign a project/task to a Delivery Member and verify that member can see and update only assigned work.
7. Test AI qualification, proposal generation, missing lead requirements and provider failures.

## Deployment preparation

Before deploying, configure the frontend API base URL through a Vite environment variable (for example, `VITE_API_URL`) instead of the current local `http://localhost:8000` constant. Configure FastAPI CORS to allow the deployed frontend origin, use a managed PostgreSQL database, set all backend environment variables in the hosting provider's secret settings, and run the backend and frontend as separate services. Do not deploy `.env`, `.venv`, `node_modules` or local database files.

For a reproducible Python deployment, create the dependency lock input from the tested virtual environment:

```bash
cd backend
source .venv/bin/activate
pip freeze > requirements.txt
```

Review the resulting file before committing it. For production, run Uvicorn without `--reload` and use the hosting provider's assigned port and HTTPS URL.

## Security notes

- Passwords are stored as password hashes; plaintext passwords must never be committed.
- JWT signing secrets, database credentials and AI provider keys belong in environment variables.
- `.env` files and virtual environments must remain untracked.
- Frontend role-based navigation is for user experience; backend authorization is mandatory and authoritative.
