# CodeRunner - Competitive Programming Platform

A highly scalable, modern competitive programming platform built with a Node.js microservices architecture, PostgreSQL, Redis, and a React/Vite frontend.

## Features Included
* **Horizontal Scaling** & Load Balancing (via Nginx)
* **Distributed Job Queue** (Bull + Redis) for async background code execution
* **Single Compilation** & **Batch Test Execution**
* **Early Termination** on failing test cases
* **Code Hash Caching** to avoid re-evaluating duplicate code
* **Stateless API** design
* **Premium Glassmorphism Dark UI** (React + Monaco Editor)

## Prerequisites

Make sure you have the following installed on your machine:
1. [Node.js](https://nodejs.org/) (v16 or higher)
2. [PostgreSQL](https://www.postgresql.org/) (Running on port 5432)
3. [Redis](https://redis.io/download) (Running on port 6379, or use Docker for Redis)
4. (Optional but Recommended) [Docker Desktop](https://www.docker.com/products/docker-desktop) for running the full distributed stack easily.

---

## Running Locally (Windows Native)

I have created dedicated `.bat` files for you to simply double-click and launch everything automatically!

### 1. Requirements
* Ensure **PostgreSQL** is running on your system (`localhost:5432` with user `postgres` / pass `postgres`). Create a database named `coderunner`.
* Ensure **Redis** is running in the background (`localhost:6379`). You can use Memurai, WSL Redis, or a Docker container `docker run -p 6379:6379 -d redis`.

### 2. Run Setup Script (Once)
1. Go to the `f:\Projects\Compiler` folder in your file explorer.
2. Double-click the **`setup.bat`** file.
   * This will download all backend/frontend packages and install the pre-made SQL schema / problems.

### 3. Start the Platform
1. In the same folder, double-click **`run.bat`**.
2. This will securely pop open 3 separate command windows for:
   * The load-balanced API
   * The high-performance Queue Worker
   * The React/Vite Glassmorphism Frontend
3. Access the platform safely via your browser at [http://localhost:5173](http://localhost:5173).

---

## Method 2: Running the Full Distributed Stack via Docker

This will spin up the database, redis cache, multiple stateless API load-balanced servers, and multiple worker nodes.

Open a terminal in the root project folder \`f:\\Projects\\Compiler\` and run:
\`\`\`powershell
# Build and start all containers in the background
docker-compose up --build -d
\`\`\`

Once the containers are running, you need to migrate the database inside the container:
\`\`\`powershell
# Run the migration script inside the api1 container
docker exec -it compiler-api1-1 npm run migrate
docker exec -it compiler-api1-1 npm run seed
\`\`\`

*(Note: Depending on your docker-compose version, the container name might slightly vary like \`compiler_api1_1\`. Use \`docker ps\` to check the exact name).*

The load-balanced API will be available at \`http://localhost:80\`.
*(You would need to update the frontend's API calls to point to this port if testing via Docker).*
