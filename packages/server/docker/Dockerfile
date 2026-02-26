# packages/server/docker/Dockerfile
# Docker container for local sandbox execution (Buddy Computer alternative)

FROM node:22-bullseye

# Install common development tools and bubblewrap for sandbox isolation
# Keep apt lists so agents can install packages
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    curl \
    ripgrep \
    jq \
    vim \
    bubblewrap

# Install common Python packages
RUN pip3 install numpy pandas matplotlib requests

# Create user directory with proper permissions
RUN mkdir -p /home/user && chmod 777 /home/user

# Copy the sandbox agent server
COPY agent/ /opt/sandbox-agent/
WORKDIR /opt/sandbox-agent
RUN npm install --production

# Expose the API port
EXPOSE 8080

# Run as root (container is already isolated by Docker)
# Bubblewrap provides filesystem isolation for each agent
WORKDIR /home/user

# Start the sandbox agent server
CMD ["node", "/opt/sandbox-agent/server.js"]
