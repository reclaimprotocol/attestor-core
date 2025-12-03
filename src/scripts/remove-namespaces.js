import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_DIR = path.join(__dirname, '../proto');

if (!fs.existsSync(PROTO_DIR)) {
    console.error(`Directory not found: ${PROTO_DIR}`);
    process.exit(1);
}

const files = fs.readdirSync(PROTO_DIR).filter(file => file.endsWith('.ts'));

files.forEach(file => {
    const filePath = path.join(PROTO_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Regex to match "export namespace Name { ... }" blocks
    // This assumes the namespace block ends with a closing brace on a new line
    // and doesn't contain nested braces that would break a simple regex.
    // Given the generated code structure, this should be safe.
    const namespaceRegex = /export namespace \w+ \{[\s\S]*?\n\}/g;

    if (namespaceRegex.test(content)) {
        console.log(`Found namespaces in ${file}. Removing...`);
        content = content.replace(namespaceRegex, '');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Namespaces removed from ${file}.`);
    } else {
        console.log(`No namespaces found in ${file}.`);
    }
});
