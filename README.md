# Team Task Manager

A full-stack assignment project where users can create projects, assign tasks, and track progress with role-based access control.

## Features

- Signup and login with JWT authentication
- Admin and Member roles
- Project and team management
- Task creation, assignment, priority, due date, and status tracking
- Dashboard with task totals, status counts, overdue work, and upcoming tasks
- REST API backed by MongoDB
- Railway-ready deployment config

## Tech Stack

- Node.js
- Express
- MongoDB + Mongoose
- JWT + bcryptjs
- HTML, CSS, and vanilla JavaScript frontend

## Local Setup

```bash
cd team-task-manager
npm install
copy .env.example .env
npm start
```

For quick local development, `.env` only needs a `JWT_SECRET`; when `MONGODB_URI` is omitted, the app stores data in `local-data.json`.

To use MongoDB locally or in production, set `MONGODB_URI` in `.env` or your host variables before starting.

Open `http://localhost:3000`.

## Demo Flow

1. Signup as an Admin.
2. Signup or create a Member account in another browser/session.
3. Login as Admin, create a project, and add members.
4. Create tasks assigned to project members.
5. Login as a Member and update task status.
6. Show the dashboard totals, overdue tasks, and status tracking.

## Railway Deployment

1. Push this `team-task-manager` folder to a GitHub repository.
2. Create a new Railway project from the GitHub repo.
3. Add a MongoDB database in Railway, or create a MongoDB Atlas cluster and copy its connection string.
4. Set these Railway variables on the app service:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_long_random_secret
NODE_ENV=production
ADMIN_INVITE_CODE=optional_admin_code
```

5. Deploy. Railway will run `npm install` and `npm start`.
6. Use the Railway public domain as your Live URL.

Production requires `MONGODB_URI`. The local JSON fallback is only for development without MongoDB.

## API Summary

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users`
- `GET /api/projects`
- `POST /api/projects` Admin only
- `PUT /api/projects/:id` Admin only
- `DELETE /api/projects/:id` Admin only
- `GET /api/tasks`
- `POST /api/tasks` Admin only
- `PUT /api/tasks/:id` Admin or assigned Member
- `DELETE /api/tasks/:id` Admin only
- `GET /api/dashboard`

## Submission Checklist

- Live Railway URL
- GitHub repo URL
- README
- 2-5 minute demo video showing Admin and Member workflows
