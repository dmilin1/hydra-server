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

## Setup Instructions

There are two ways to set up the server: **Docker Compose** or **Manual Setup**.

---

### Docker Compose Setup

This method uses Docker to build and run the application in a container without needing to clone the repository yourself.

#### Prerequisites

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](https://docs.docker.com/compose/install/)

#### 1. Create the `compose.yaml` file

Copy the [`compose.yaml`](compose.yaml) file or the following codeblock below:

```yaml
services:
  hydra-server:
    build:
      context: https://github.com/dmilin1/hydra-server.git
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
      - ./data:/data
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - IS_CUSTOM_SERVER=true
```

#### 2. Create the .env file

```env
# Get your API key from https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here 
# Generate a key with `openssl rand -hex 32`
ENCRYPTION_KEY=your_32_byte_encryption_key_here
# Set a strong password to access the dashboard
DASHBOARD_PASSWORD=your_secure_dashboard_password
IS_CUSTOM_SERVER=true
```

#### Environment Variables

|Variable|Default Value|Remarks|
|---|---|---|
|GROQ_API_KEY|---|GROQ API Key for AI features. Only needed if AI_PROVIDER is "groq" (optional)|
|ENCRYPTION_KEY|---|Generate with `openssl rand -hex 32` (required)|
|DASHBOARD_PASSWORD|---|Password to access dashboard (required)|
|IS_CUSTOM_SERVER|---|Must be set to true for self hosted server (required)|
|AI_PROVIDER|groq| Specify the AI provider to use for post/comments summary, database query and posts filtering (optional)|

Below environment variables need to be set only if `AI_PROVIDER` is set to `openai`

|Variable|Default Value|Remarks|
|---|---|---|
|OPENAI_BASE_URL|`https://api.openai.com/v1`|Base URL for OpenAI. (optional)|
|OPENAI_API_KEY|---|OpenAI API key. (optional)|
|OPENAI_SUMMARY_MODEL|gpt-4.1-mini|Model used for posts/comments summary. (optional)|
|OPENAI_QUERY_MODEL|gpt-4.1-mini|Model used for database query. (optional)|
|OPENAI_FILTER_MODEL|gpt-4.1-mini|Model used for posts filtering.(optional)|
---

### Manual Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/dmilin1/hydra-server.git
cd hydra-server
```

#### 2. Install Dependencies

Install backend and frontend dependencies:

```bash
bun install
cd frontend
bun install
cd ..
```

### Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Get your API key from https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here 
# Generate a key with `openssl rand -hex 32`
ENCRYPTION_KEY=your_32_byte_encryption_key_here
# Set a strong password to access the dashboard
DASHBOARD_PASSWORD=your_secure_dashboard_password

IS_CUSTOM_SERVER=true
```

#### 4. Build the Frontend

```bash
cd frontend
bun run build
cd ..
```

#### 5. Running the Server

```bash
bun run start
```

The server will start on `http://localhost:3000`.

### Accessing the Dashboard

Once the server is running (either via Docker or manually), open your browser and navigate to `http://localhost:3000`. You'll be prompted to enter the dashboard password you set in your `.env` file.

### Connecting to Hydra App

Navigate to Settings => Advanced => Use Custom Server. Enable it and enter the public IP or domain where you are hosting the server. If hosted at home, you will likely need to set up a reverse proxy or port forwarding for port 3000. For example: `http://your_public_ip:3000`.

### Enable auto-start on Boot

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