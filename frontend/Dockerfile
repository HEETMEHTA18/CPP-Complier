# Use Node.js as the base image for building
FROM node:18-bullseye-slim AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all secrets/environment if needed, but Vite needs them during build
# For local dev, we might just copy everything
COPY . .

# Build the app
RUN npm run build

# Use Nginx to serve the static files
FROM nginx:alpine

# Copy the built files from the previous stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80 (default for Nginx)
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
