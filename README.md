# Hydra Server

A backend service for the Hydra for Reddit app. Using a custom server will unlock all Hydra Pro features for free. If you have the knowhow to get this set up, please consider contributing your skills to the project!

## Features

- 🔔 Reddit message monitoring with push notifications
- 📱 Mobile app integration via Expo push notifications
- 💳 Subscription management with RevenueCat
- 🤖 AI-powered features using Groq API
- 📊 Admin dashboard for monitoring and management
- 🗄️ SQLite database with Drizzle ORM
- ⚡ Built with Bun for fast performance

## Prerequisites

- [Bun](https://bun.sh) v1.2.5 or higher
- Node.js 18+ (for some build tools)
- A Groq API key for AI features

## Project Structure

```
hydra-server/
├── frontend/        # React + Vite dashboard
├── routes/          # API endpoints
├── services/        # Business logic services
├── middleware/      # Express-style middleware
├── db/              # Database schema and migrations
├── tasks/           # Background task definitions
├── schedules/       # Scheduled job configurations
└── utils/           # Utility functions
```

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/dmilin1/hydra-server.git
cd hydra-server
```

### 2. Install Dependencies

Install backend dependencies:

```bash
bun install
```

Install frontend dependencies:

```bash
cd frontend
bun install
cd ..
```

### 3. Environment Configuration

Create a `.env` file in the root directory with the following variables (or copy the .env.example file):

```env
GROQ_API_KEY=your_groq_api_key
# You can generate an encryption key with this command `openssl enc -aes-256-cbc -k secret -P -md sha256`
ENCRYPTION_KEY=your_32_character_encryption_key_here
DASHBOARD_PASSWORD=your_secure_dashboard_password

IS_CUSTOM_SERVER=true
```

**Important Notes:**

- `ENCRYPTION_KEY` must be exactly 32 characters long
- `DASHBOARD_PASSWORD` should be changed for security purposes
- `IS_CUSTOM_SERVER=true` is required to bypass subscription checks

### 5. Build the Frontend

Build the React dashboard:

```bash
cd frontend
bun run build
cd ..
```

The built files will be served automatically by the backend server.

### 6. Running the Server

```bash
bun run start
```

The server will start on `http://localhost:3000`

### 7. Accessing the Dashboard

Open your browser and navigate to `http://localhost:3000`. You'll be prompted to enter the dashboard password (the value of `DASHBOARD_PASSWORD` from your `.env` file).

### 8. Connecting to Hydra App

Navigate to Settings => Advanced => Use Custom Server. Enable it and enter the public IP or domain you're hosting the server on without a trailing slash. Hydra will automatically attempt to validate if the server is working. If hosted on a home computer, you will likely need to set up port forwarding and include port 3000 (or whatever external port you chose).

### 9. Enable auto-start on Boot

If running on a debian distro the following commands allow the server to auto run on startup:


Create a systemd service file
```bash
sudo nano /etc/systemd/system/hydra-server.service
```

Enter the following code into the service:
```bash
[Unit]
Description=Hydra Server Bun Script
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/hydra-server
ExecStart=/home/pi/.bun/bin/bun run start
Restart=always
RestartSec=5
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/pi/.bun/bin

[Install]
WantedBy=multi-user.target
```

Then reload and enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable hydra-server.service
```

Then run the following to start and check the service:
```bash
sudo systemctl start hydra-server.service
sudo systemctl status hydra-server.service
```

The service should now auto-start on boot.
