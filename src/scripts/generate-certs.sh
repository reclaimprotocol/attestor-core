#!/bin/bash

mkdir cert

cd cert

openssl genrsa -out private-key.pem 1024

openssl req -new -key private-key.pem -out csr.pem

openssl x509 -req -in csr.pem -signkey private-key.pem -out public-cert.pem