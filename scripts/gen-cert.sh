#!/bin/bash
# Generate self-signed certificate for HTTPS
# Supports both domain name and IP address access
#
# Usage:
#   ./scripts/gen-cert.sh                          # default: localhost + 127.0.0.1
#   ./scripts/gen-cert.sh 192.168.1.100             # intranet IP
#   ./scripts/gen-cert.sh 192.168.1.100 9000        # intranet IP + custom port
#   ./scripts/gen-cert.sh autoclaim.internal        # domain name

HOST=${1:-"localhost"}
PORT=${2:-"443"}
CERT_DIR="$(dirname "$0")/../certs"

mkdir -p "$CERT_DIR"

# Detect if HOST is an IP address
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_IP=true
  echo "Generating certificate for IP: $HOST:$PORT"
else
  IS_IP=false
  echo "Generating certificate for domain: $HOST:$PORT"
fi

# Generate CA
openssl genrsa -out "$CERT_DIR/ca.key" 4096 2>/dev/null
openssl req -new -x509 -days 3650 -key "$CERT_DIR/ca.key" \
  -out "$CERT_DIR/ca.crt" \
  -subj "/C=SG/O=DesaySV/CN=AutoClaim Internal CA" 2>/dev/null

# Generate server key
openssl genrsa -out "$CERT_DIR/server.key" 2048 2>/dev/null

# Build SAN config — always include localhost + 127.0.0.1 for dev convenience
cat > "$CERT_DIR/san.cnf" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C = SG
O = DesaySV
CN = ${HOST}

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

# Add the user-specified host
if [ "$IS_IP" = true ]; then
  echo "IP.2 = ${HOST}" >> "$CERT_DIR/san.cnf"
else
  echo "DNS.2 = ${HOST}" >> "$CERT_DIR/san.cnf"
  echo "DNS.3 = *.${HOST}" >> "$CERT_DIR/san.cnf"
fi

# Generate CSR and sign
openssl req -new -key "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.csr" \
  -config "$CERT_DIR/san.cnf" 2>/dev/null

openssl x509 -req -days 3650 \
  -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" \
  -CAkey "$CERT_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERT_DIR/server.crt" \
  -extensions v3_req \
  -extfile "$CERT_DIR/san.cnf" 2>/dev/null

# Cleanup temp files
rm -f "$CERT_DIR/server.csr" "$CERT_DIR/san.cnf" "$CERT_DIR/ca.srl"

echo ""
echo "=== Certificates generated ==="
echo ""
echo "Files in: $CERT_DIR/"
echo "  ca.crt      — CA root certificate"
echo "  server.crt  — server certificate"
echo "  server.key  — server private key"
echo ""
echo "=== Next steps ==="
echo ""
if [ "$IS_IP" = true ]; then
  echo "1. Set in .env:"
  echo "   NEXT_PUBLIC_APP_URL=\"https://${HOST}:${PORT}\""
  echo ""
  echo "2. Feishu redirect URLs to add:"
  echo "   https://${HOST}:${PORT}/api/auth/callback"
  echo "   https://localhost:${PORT}/api/auth/callback"
  echo "   https://open.feishu.cn/api-explorer/loading"
  echo ""
  echo "3. Feishu webhook URL:"
  echo "   https://${HOST}:${PORT}/api/approval/webhook"
else
  echo "1. Set in .env:"
  echo "   NEXT_PUBLIC_APP_URL=\"https://${HOST}\""
  echo ""
  echo "2. Feishu redirect URLs to add:"
  echo "   https://${HOST}/api/auth/callback"
  echo "   https://localhost:${PORT}/api/auth/callback"
  echo "   https://open.feishu.cn/api-explorer/loading"
  echo ""
  echo "3. Feishu webhook URL:"
  echo "   https://${HOST}/api/approval/webhook"
fi
echo ""
echo "4. Trust CA cert on client machines:"
echo "   macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERT_DIR/ca.crt"
echo "   Ubuntu:  sudo cp $CERT_DIR/ca.crt /usr/local/share/ca-certificates/autoclaim-ca.crt && sudo update-ca-certificates"
echo "   Windows: double-click ca.crt → Install → Trusted Root Certification Authorities"
