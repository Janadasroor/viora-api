#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN} Viora Backend Installer${NC}"

# Helper to check command existence
status_check() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✔ $1 is already installed.${NC}"
        return 0
    else
        echo -e "${YELLOW}➜ $1 is missing. Installing...${NC}"
        return 1
    fi
}

# Update package list
echo -e "\n${YELLOW}Updating package lists...${NC}"
sudo apt-get update

# 1. Install Node.js
if ! command -v node &> /dev/null; then
    echo -e "\n${YELLOW}Installing Node.js...${NC}"
    # Using NodeSource for newer versions (approx) or standard apt
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "${GREEN}✔ Node.js is installed.$(node -v)${NC}"
fi

# 2. Install FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo -e "\n${YELLOW}Installing FFmpeg...${NC}"
    sudo apt-get install -y ffmpeg
else
     echo -e "${GREEN}✔ FFmpeg is installed.${NC}"
fi

# 3. Install Docker
if ! command -v docker &> /dev/null; then
    echo -e "\n${YELLOW}Installing Docker...${NC}"
    sudo apt-get install -y docker.io docker-compose
    
    # Start and enable docker
    sudo systemctl start docker
    sudo systemctl enable docker
    
    # Add user to docker group (requires logout/login)
    sudo usermod -aG docker $USER
    echo -e "${YELLOW}  Added $USER to docker group. You may need to log out and back in for this to take effect.${NC}"
else
    echo -e "${GREEN}✔ Docker is installed.${NC}"
fi

echo -e "\n${GREEN} Installation Complete!${NC}"
echo -e "You can now run: ${YELLOW}npm install && docker-compose up -d${NC}"
