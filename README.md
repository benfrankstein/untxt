# OCR Platform

A secure, layered OCR (Optical Character Recognition) platform built with modern web technologies and AI-powered text extraction.

## Overview

This platform provides a complete OCR solution with a public-facing web interface, administrative tools, and a scalable processing backend powered by the Qwen3 model. The architecture is designed for deployment on a single machine with security-first principles.

## Architecture

The platform uses a 4-layer architecture, with all internal services bound to localhost and only HTTPS exposed publicly:

### Layer 1: Reverse Proxy (Nginx)
- **Purpose**: SSL termination, routing, and rate limiting
- **Ports**: 443 (HTTPS, public), 80 (HTTP redirect)
- **Features**:
  - TLS 1.3 encryption
  - Request rate limiting
  - Routes traffic to internal services
  - Only publicly accessible component

### Layer 2: Application Layer
- **Frontend (Next.js)**: Port 3000
  - Public web interface for OCR tasks
  - Real-time status updates via WebSocket

- **Backend (Node.js)**: Port 8080
  - RESTful API endpoints
  - WebSocket server for real-time communication
  - Task queue management

- **Admin UI (Electron)**: Desktop application
  - System monitoring and configuration
  - User management
  - Direct backend connection

### Layer 3: Processing Layer
- **OCR Workers (Python Flask)**: Port 5000
  - Qwen3-powered text extraction
  - Asynchronous task processing
  - Result generation and storage

### Layer 4: Data Layer
- **PostgreSQL**: Port 5432
  - Persistent storage for users, tasks, and results

- **Redis**: Port 6379
  - Task queue management
  - Pub/sub messaging
  - Session caching

- **File Storage**: `/var/ocr-platform/`
  - Uploaded documents
  - Processed results

## Security Model

- All internal services bound to `127.0.0.1` (localhost only)
- Only Nginx exposed on `0.0.0.0:443`
- Firewall allows only port 443 inbound
- SSL/TLS encryption for all public traffic
- Rate limiting to prevent abuse

## Technology Stack

- **Frontend**: Next.js (React)
- **Backend**: Node.js with Express
- **Admin UI**: Electron
- **OCR Engine**: Python Flask + Qwen3 model
- **Databases**: PostgreSQL, Redis
- **Reverse Proxy**: Nginx
- **OS**: Linux (Ubuntu recommended)

## Prerequisites

- Linux-based server (Ubuntu 20.04+ recommended)
- Node.js 18+
- Python 3.9+
- PostgreSQL 14+
- Redis 6+
- Nginx
- Domain name with DNS configured
- SSL certificates (Let's Encrypt recommended)
- Sufficient disk space for file storage and models

## Local Development

### Setup
1. Clone all component repositories
2. Install dependencies:
   ```bash
   # Node.js dependencies
   cd frontend && npm install
   cd ../backend && npm install

   # Python dependencies
   cd ../workers
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Start local services:
   ```bash
   # Start PostgreSQL and Redis
   sudo systemctl start postgresql redis

   # Start workers
   cd workers && python app.py

   # Start backend
   cd backend && npm run dev

   # Start frontend
   cd frontend && npm run dev

   # Launch Electron admin UI
   cd admin-ui && npm start
   ```

### Testing
- Run unit tests for each component
- Perform end-to-end OCR workflow tests
- Test WebSocket connections
- Verify rate limiting and security measures
- Load testing with Apache Bench or similar tools

## Production Deployment

### Server Setup
1. Provision server with adequate resources
2. Configure firewall (only port 443 allowed)
3. Set up SSH with key-based authentication
4. Point domain DNS to server IP

### Installation
1. Install all required services
2. Configure systemd services for auto-restart
3. Deploy code to `/opt/ocr-platform/` or similar
4. Set up SSL certificates with certbot
5. Configure Nginx reverse proxy
6. Initialize PostgreSQL database schema
7. Start all services

### Post-Deployment
- Configure automated backups for database and files
- Set up monitoring (Prometheus, Grafana, or similar)
- Enable fail2ban for intrusion detection
- Configure log rotation
- Test complete workflow from public domain

## Project Structure

```
ocr-platform/
├── frontend/          # Next.js public web interface
├── backend/           # Node.js API and WebSocket server
├── workers/           # Python Flask OCR processing
├── admin-ui/          # Electron desktop administration
├── nginx/             # Nginx configuration files
└── docs/              # Additional documentation
```

## Configuration

Environment variables and configuration files are used to manage:
- Database connection strings
- Redis connection details
- API keys and secrets
- File storage paths
- Port configurations
- SSL certificate paths

## Monitoring and Logs

- Application logs: `/var/log/ocr-platform/`
- Nginx logs: `/var/log/nginx/`
- PostgreSQL logs: `/var/log/postgresql/`
- System services: `journalctl -u <service-name>`

## Scaling Considerations

While designed for single-machine deployment, the architecture can scale by:
- Adding worker instances for OCR processing
- Implementing Redis Cluster for distributed queue
- Using PostgreSQL replication for read scaling
- Moving file storage to object storage (S3, etc.)
- Load balancing with multiple application instances

## License

[Your License Here]

## Contributing

[Your contribution guidelines here]

## Support

[Your support/contact information here]
