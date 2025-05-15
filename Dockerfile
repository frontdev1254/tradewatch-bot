# Use an official lightweight Node.js image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy only dependency definitions first (to leverage Docker cache)
COPY package*.json ./

# Install PM2 globally and project dependencies
RUN npm install -g pm2
RUN npm install

# Copy all remaining source files into the container
COPY . .

# Expose the port used for the healthcheck endpoint
EXPOSE 3000

# Start the app using PM2 with the specified ecosystem configuration
CMD ["pm2-runtime", "config/ecosystem.config.js"]